const pool = require('../db/pool');

/**
 * Rolling the school year over.
 *
 * When the active school year's end date passes, the school does not stop
 * existing: it starts the next one. Doing that by hand means re-typing every
 * section and every teacher's whole timetable, which is where mistakes come
 * from, so the system does it:
 *
 *   1. The next school year is created (2026-2027 becomes 2027-2028) with
 *      provisional dates: the same days of the year, one year later.
 *   2. Everything that describes how the school is organised is copied into
 *      it — sections (with their capacity and adviser), subjects, and every
 *      schedule period, with the same teacher, subject, section, days and
 *      times. Each teacher therefore starts the new year with the timetable
 *      they ended the last one with, and the administrator can change any of
 *      it afterwards: moving a teacher from Grade 1 to Grade 5 is editing one
 *      copied row, not building a schedule from nothing.
 *   3. The new year becomes the active one, but with enrollment CLOSED and
 *      its dates marked as not yet confirmed. The administrator has to enter
 *      the real start and end dates before enrollment can be opened, which is
 *      what makes "the admin must input the start date and end date" true
 *      rather than a suggestion.
 *
 * Last year's rows are never deleted. Its schedule simply stops being the
 * current one, because every schedule row belongs to a school year. That
 * keeps last year's master lists, class records and audit trail readable —
 * which is also what school information systems do, since a school has to be
 * able to answer "who taught this child last year?" long after the year ends.
 *
 * This runs at start-up and once an hour (server/index.js), inside a Postgres
 * advisory lock so two processes never roll the same year over twice.
 */

const ROLLOVER_LOCK = 7203002;

/** '2026-2027' -> '2027-2028'. Returns null for anything else. */
function nextLabel(label) {
  const m = /^(\d{4})-(\d{4})$/.exec(String(label || '').trim());
  if (!m) return null;
  return `${Number(m[1]) + 1}-${Number(m[2]) + 1}`;
}

/** Same day of the year, one year later. Feb 29 becomes Feb 28. */
function oneYearLater(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear() + 1;
  const month = d.getUTCMonth();
  const day = Math.min(d.getUTCDate(), new Date(Date.UTC(y, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(y, month, day, d.getUTCHours(), d.getUTCMinutes()));
}

/**
 * Copies the school's structure from one year into another, inside the
 * caller's transaction. Returns what was copied, for the audit log.
 *
 * Nothing here touches learners or applications: those belong to the year
 * they were made in. Only the shape of the school carries over.
 */
async function copyStructure(db, fromYearId, toYearId) {
  // Sections: same names, capacities and advisers.
  const { rows: sections } = await db.query(
    `INSERT INTO sections (name, grade_level_id, school_year_id, capacity, adviser_teacher_id)
     SELECT s.name, s.grade_level_id, $2, s.capacity, s.adviser_teacher_id
     FROM sections s
     WHERE s.school_year_id = $1
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [fromYearId, toYearId]
  );

  // Subjects: same names per grade level.
  const { rows: subjects } = await db.query(
    `INSERT INTO subjects (name, grade_level_id, school_year_id, is_domain)
     SELECT sub.name, sub.grade_level_id, $2, sub.is_domain
     FROM subjects sub
     WHERE sub.school_year_id = $1
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [fromYearId, toYearId]
  );

  // Schedule periods, matched to the copies by name rather than by id.
  const { rows: entries } = await db.query(
    `INSERT INTO schedule_entries
       (section_id, school_year_id, subject_id, teacher_id, session, days, start_time, end_time, room, role_type)
     SELECT ns.id, $2, nsub.id, se.teacher_id, se.session, se.days, se.start_time, se.end_time, se.room, se.role_type
     FROM schedule_entries se
     JOIN sections os ON os.id = se.section_id
     JOIN sections ns ON ns.school_year_id = $2
                     AND ns.grade_level_id = os.grade_level_id
                     AND lower(btrim(ns.name)) = lower(btrim(os.name))
     LEFT JOIN subjects osub ON osub.id = se.subject_id
     LEFT JOIN subjects nsub ON nsub.school_year_id = $2
                            AND nsub.grade_level_id = osub.grade_level_id
                            AND lower(btrim(nsub.name)) = lower(btrim(osub.name))
     WHERE se.school_year_id = $1
       AND (se.subject_id IS NULL OR nsub.id IS NOT NULL)
     RETURNING id`,
    [fromYearId, toYearId]
  );

  return { sections: sections.length, subjects: subjects.length, entries: entries.length };
}

/**
 * Creates the year that follows `fromYear` and fills it in.
 * `dates` may override the provisional start and end.
 */
async function createFollowingYear(db, fromYear, dates = {}) {
  const label = nextLabel(fromYear.label);
  if (!label) {
    const err = new Error(`School year "${fromYear.label}" is not in the form 2026-2027, so the next one cannot be worked out.`);
    err.status = 400;
    throw err;
  }

  const { rows: [existing] } = await db.query('SELECT id FROM school_years WHERE label = $1', [label]);
  if (existing) return { created: false, id: existing.id, label };

  const opensAt = dates.opensAt || oneYearLater(fromYear.opens_at).toISOString();
  const closesAt = dates.closesAt || oneYearLater(fromYear.closes_at).toISOString();

  const { rows: [created] } = await db.query(
    `INSERT INTO school_years (label, opens_at, closes_at, is_active, enrollment_open, dates_confirmed)
     VALUES ($1, $2, $3, FALSE, FALSE, $4)
     RETURNING id, label, opens_at, closes_at`,
    [label, opensAt, closesAt, Boolean(dates.opensAt && dates.closesAt)]
  );

  const copied = await copyStructure(db, fromYear.id, created.id);
  return { created: true, id: created.id, label, year: created, copied };
}

/** Makes one year the active one, inside the caller's transaction. */
async function activate(db, yearId) {
  await db.query('UPDATE school_years SET is_active = FALSE WHERE is_active = TRUE');
  await db.query('UPDATE school_years SET is_active = TRUE WHERE id = $1', [yearId]);
}

/**
 * The automatic part: if the active school year has ended, start the next one.
 * Returns null when there was nothing to do.
 */
async function rolloverIfEnded() {
  const client = await pool.connect();
  try {
    const { rows: [lock] } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [ROLLOVER_LOCK]);
    if (!lock.ok) return null;
    try {
      const { rows: [active] } = await client.query(
        // A year rolls over when the ACADEMIC year ends, not when its short
        // enrollment window (closes_at) shuts. The academic year runs about
        // ten months from the first day of classes — the span the enrollment
        // end used to stand in for before it became a window of its own.
        `SELECT id, label, opens_at, closes_at
         FROM school_years
         WHERE is_active = TRUE
           AND (COALESCE(classes_start_on, (opens_at AT TIME ZONE 'Asia/Manila')::date)
                  + INTERVAL '10 months')::date <= (NOW() AT TIME ZONE 'Asia/Manila')::date
         LIMIT 1`
      );
      if (!active) return null;

      await client.query('BEGIN');
      const result = await createFollowingYear(client, active);
      await activate(client, result.id);
      await client.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
         VALUES (NULL, 'SCHOOL_YEAR_ROLLED_OVER', 'school_year', $1, $2)`,
        [result.id, JSON.stringify({ from: active.label, to: result.label, copied: result.copied || null })]
      );
      await client.query('COMMIT');

      console.log(`School year ${active.label} ended. ${result.label} created and made active`
        + (result.copied ? ` (${result.copied.sections} sections, ${result.copied.subjects} subjects, ${result.copied.entries} schedule periods copied).` : '.'));
      return result;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [ROLLOVER_LOCK]);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('School year rollover failed:', err.message);
    return null;
  } finally {
    client.release();
  }
}

/** Checked once at start-up, then every hour. */
function startRolloverScheduler() {
  if (process.env.DISABLE_ROLLOVER_SCHEDULER === '1') return;
  setTimeout(() => { rolloverIfEnded(); }, 20 * 1000).unref();
  setInterval(() => { rolloverIfEnded(); }, 60 * 60 * 1000).unref();
}

module.exports = {
  nextLabel, oneYearLater, copyStructure, createFollowingYear, activate,
  rolloverIfEnded, startRolloverScheduler,
};
