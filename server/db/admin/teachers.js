const pool = require('../pool');
const { getActiveSchoolYear } = require('./settings');
const { canonicalPhone } = require('../../utils/validators');

const SCHOOL_DAYS_PER_WEEK = 5;

// The single busiest day this teacher currently has, in the active
// school year — used to stop an admin from lowering a teacher's
// daily cap below what's already scheduled. Existing periods aren't
// touched automatically; the admin has to remove enough of them
// first, the same way shrinking a section's capacity below its
// current enrollment is blocked rather than silently accepted.
async function getBusiestDayCount(teacherId, schoolYearId) {
  const result = await pool.query(
    `SELECT day, COUNT(*)::int AS count
     FROM schedule_entries, unnest(days) AS day
     WHERE teacher_id = $1 AND school_year_id = $2 AND role_type = 'subject'
     GROUP BY day ORDER BY count DESC LIMIT 1`,
    [teacherId, schoolYearId]
  );
  return result.rows[0]?.count || 0;
}

// The teacher's own name, as one normalised string: "first middle
// last", lower-cased, with runs of whitespace squeezed to a single
// space and a missing middle name simply skipped (concat_ws drops
// NULLs).
const FULL_NAME_SQL = `lower(regexp_replace(trim(concat_ws(' ', t.first_name, t.middle_name, t.last_name)), '\\s+', ' ', 'g'))`;

// % and _ typed into the search box are literal characters to the
// person typing them, not LIKE wildcards.
function likeLiteral(value) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Searching a teacher's whole name has to find that one teacher.
 * The term is split on spaces and commas and EVERY word has to
 * appear somewhere in that teacher's normalised full name, so
 * "Maria Santos", "santos maria", "Santos, Maria" and
 * "Maria Cruz Santos" all land on the same person regardless of
 * word order, case, doubled spaces, a comma, or whether the middle
 * name was typed. A single word still behaves exactly as it did
 * before (a substring of any name part), and the term as typed is
 * still matched against the email so searching by address keeps
 * working.
 */
function buildSearchClause(search, params) {
  const words = String(search || '').replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const nameConds = words.map((word) => {
    params.push(`%${likeLiteral(word.toLowerCase())}%`);
    return `${FULL_NAME_SQL} LIKE $${params.length}`;
  });
  params.push(`%${likeLiteral(String(search).trim())}%`);
  return `WHERE ((${nameConds.join(' AND ')}) OR t.email ILIKE $${params.length})`;
}

async function listTeachers(search, schoolYearId) {
  const params = [];
  const where = buildSearchClause(search, params);
  params.push(schoolYearId || null);
  const yearParamIndex = params.length;
  const result = await pool.query(
    `SELECT t.id, t.first_name, t.middle_name, t.last_name, t.email, t.is_active, t.status, t.max_periods_per_day,
            (t.max_periods_per_day * ${SCHOOL_DAYS_PER_WEEK}) AS weekly_load_cap,
            COALESCE(array_agg(DISTINCT gl.name) FILTER (WHERE gl.name IS NOT NULL), '{}') AS grade_levels,
            COALESCE(array_agg(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL), '{}') AS subjects,
            COUNT(DISTINCT se.id)::int AS weekly_load
     FROM teachers t
     LEFT JOIN teacher_subjects ts ON ts.teacher_id = t.id
     LEFT JOIN subjects s ON s.id = ts.subject_id
     LEFT JOIN grade_levels gl ON gl.id = s.grade_level_id
     LEFT JOIN schedule_entries se ON se.teacher_id = t.id AND se.role_type = 'subject'
       AND ($${yearParamIndex}::smallint IS NULL OR se.school_year_id = $${yearParamIndex})
     ${where}
     GROUP BY t.id
     -- Teachers who are no longer teaching sink to the bottom: the list is
     -- worked through from the top, and they cannot be given a class anyway.
     ORDER BY (t.is_active AND t.status = 'active') DESC, t.last_name, t.first_name`,
    params
  );
  return result.rows;
}

async function getTeacherById(id) {
  const result = await pool.query(
    `SELECT id, first_name, middle_name, last_name, email,
            pgp_sym_decrypt(contact_number, $2)::text AS contact_number,
            degree, major, date_hired, is_active, status, sex, prc_license_number, max_periods_per_day,
            pgp_sym_decrypt(address, $2)::text AS address,
            COALESCE((SELECT array_agg(subject_id) FROM teacher_subjects WHERE teacher_id = teachers.id), '{}') AS subject_ids
     FROM teachers WHERE id = $1`,
    [id, process.env.ENCRYPTION_KEY]
  );
  return result.rows[0] || null;
}

async function findTeacherByEmail(email) {
  const result = await pool.query('SELECT id FROM teachers WHERE email = $1', [email]);
  return result.rows[0] || null;
}

/**
 * Checks for a duplicate name or contact number among teachers,
 * excluding the record currently being edited (if any). Contact
 * number is encrypted at rest with non-deterministic ciphertext
 * (pgp_sym_encrypt includes a random session key), so two identical
 * numbers never encrypt to the same bytes — matching has to happen
 * on the decrypted value in application code, not as a SQL WHERE
 * equality. At single-school roster scale (tens to low hundreds of
 * teachers) decrypting the whole table for this check is cheap;
 * it would need rethinking well before that stopped being true.
 */
async function findDuplicateTeacher({ firstName, lastName, contactNumber, prcLicenseNumber, excludeId }) {
  const key = process.env.ENCRYPTION_KEY;
  const result = await pool.query(
    `SELECT id, first_name, last_name, prc_license_number,
            pgp_sym_decrypt(contact_number, $1)::text AS contact_number
     FROM teachers WHERE ($2::int IS NULL OR id <> $2)`,
    [key, excludeId || null]
  );
  const norm = (s) => (s || '').trim().toLowerCase();
  const targetName = `${norm(firstName)} ${norm(lastName)}`;
  const targetPrc = (prcLicenseNumber || '').trim();
  for (const row of result.rows) {
    if (`${norm(row.first_name)} ${norm(row.last_name)}` === targetName) {
      return { field: 'name', existing: row };
    }
    if (contactNumber && canonicalPhone(row.contact_number) === canonicalPhone(contactNumber)) {
      return { field: 'contactNumber', existing: row };
    }
    // prc_license_number isn't encrypted (it's not the kind of PII
    // contact_number/address are), so this compares directly rather
    // than needing the decrypt-then-compare dance those two need.
    if (targetPrc && row.prc_license_number && row.prc_license_number.trim() === targetPrc) {
      return { field: 'prcLicenseNumber', existing: row };
    }
  }
  return null;
}

async function createTeacher(db, {
  firstName, lastName, middleName, email, contactNumber, degree, major,
  dateHired, sex, prcLicenseNumber, address, maxPeriodsPerDay, createdBy,
}) {
  const key = process.env.ENCRYPTION_KEY;
  const result = await db.query(
    `INSERT INTO teachers (
       first_name, middle_name, last_name, email, contact_number, degree, major,
       date_hired, sex, prc_license_number, address, max_periods_per_day, created_by
     )
     VALUES ($1, $2, $3, $4, pgp_sym_encrypt($5::text, $13), $6, $7, $8, $9, $10,
             CASE WHEN $11::text IS NULL THEN NULL ELSE pgp_sym_encrypt($11::text, $13) END,
             -- A full teaching day, when the form did not say otherwise.
             COALESCE($12, 10), $14)
     RETURNING id, first_name, last_name, email`,
    [
      firstName, middleName || null, lastName, email, contactNumber || null, degree || null, major || null,
      dateHired || null, sex || null, prcLicenseNumber || null, address || null, maxPeriodsPerDay || null, key, createdBy,
    ]
  );
  return result.rows[0];
}

const DAY_NAMES = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };

// "Grade 2 – Sampaguita Mon/Wed/Fri 08:00–09:00" — enough for an
// admin to walk over to Class Schedules and find the exact period
// the message is talking about.
function describePeriod(row) {
  const days = (row.days || []).map((d) => DAY_NAMES[d] || `Day ${d}`).join('/');
  const when = row.start_time
    ? `${String(row.start_time).slice(0, 5)}\u2013${String(row.end_time).slice(0, 5)}`
    : 'all day';
  return `${row.grade_level_name} \u2013 ${row.section_name}${days ? ` ${days}` : ''} ${when}`;
}

/**
 * Every period this teacher is scheduled to teach in the given
 * school year that is tied to a specific subject. A subject with
 * even one of these cannot be taken off the teacher: the class
 * still has to be taught by somebody, so the period has to move to
 * another teacher first.
 */
async function getScheduledSubjectPeriods(teacherId, schoolYearId) {
  const result = await pool.query(
    `SELECT se.subject_id, sub.name AS subject_name,
            gl.name AS grade_level_name, sec.name AS section_name,
            se.days, se.start_time, se.end_time
     FROM schedule_entries se
     JOIN sections sec ON sec.id = se.section_id
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     JOIN subjects sub ON sub.id = se.subject_id
     WHERE se.teacher_id = $1 AND se.school_year_id = $2 AND se.subject_id IS NOT NULL
     ORDER BY sub.name, gl.name, sec.name, se.start_time NULLS LAST`,
    [teacherId, schoolYearId]
  );
  return result.rows;
}

// The same thing grouped per subject, in the shape the edit form
// uses to disable a checkbox and explain why.
async function getLockedSubjects(teacherId, schoolYearId) {
  if (!schoolYearId) return [];
  const grouped = new Map();
  for (const row of await getScheduledSubjectPeriods(teacherId, schoolYearId)) {
    const key = Number(row.subject_id);
    if (!grouped.has(key)) {
      grouped.set(key, { subjectId: key, subjectName: row.subject_name, periods: [] });
    }
    grouped.get(key).periods.push(describePeriod(row));
  }
  return [...grouped.values()];
}

/**
 * Adding a subject to a teacher is always fine. REMOVING one is
 * refused while that teacher still has periods of it on the active
 * school year's timetable — the only way out is to move those
 * periods to another teacher first (Teachers → Transfer schedule, or
 * by re-assigning them in Class Schedules).
 */
async function setTeacherSubjects(db, teacherId, subjectIds, schoolYearId) {
  const wanted = new Set((subjectIds || []).map(Number));
  const current = (await db.query('SELECT subject_id FROM teacher_subjects WHERE teacher_id = $1', [teacherId]))
    .rows.map((r) => Number(r.subject_id));
  const removing = current.filter((id) => !wanted.has(id));

  if (removing.length > 0 && schoolYearId) {
    const locked = (await getLockedSubjects(teacherId, schoolYearId))
      .filter((l) => removing.includes(Number(l.subjectId)));
    if (locked.length > 0) {
      const one = locked.length === 1;
      const detail = locked.map((l) => `${l.subjectName} (${l.periods.join('; ')})`).join('; ');
      const err = new Error(
        `${one ? 'This subject is' : 'These subjects are'} still scheduled for this teacher, so `
        + `${one ? 'it' : 'they'} cannot be removed: ${detail}. Move `
        + `${one ? 'that period' : 'those periods'} to another teacher first, then remove `
        + `${one ? 'the subject' : 'the subjects'}.`
      );
      err.status = 409;
      err.reason = 'subject_scheduled';
      err.lockedSubjects = locked;
      throw err;
    }
  }

  if (removing.length > 0) {
    await db.query(
      'DELETE FROM teacher_subjects WHERE teacher_id = $1 AND subject_id = ANY($2::int[])',
      [teacherId, removing]
    );
  }
  for (const subjectId of wanted) {
    await db.query(
      'INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [teacherId, subjectId]
    );
  }
}

/**
 * Everything this teacher is still booked for in the given school
 * year — subject periods AND adviser roles. Deactivating a teacher
 * is refused while this is non-empty, and the labels here are what
 * the refusal lists back to the admin.
 */
async function getActiveYearAssignments(teacherId, schoolYearId, db = pool) {
  if (!schoolYearId) return [];
  const result = await db.query(
    `SELECT se.id, se.role_type, se.days, se.start_time, se.end_time, se.subject_id,
            gl.name AS grade_level_name, sec.name AS section_name,
            COALESCE(sub.name, CASE WHEN se.role_type = 'adviser'
                                    THEN 'Adviser (all subjects)' ELSE 'Class' END) AS subject_name
     FROM schedule_entries se
     JOIN sections sec ON sec.id = se.section_id
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     LEFT JOIN subjects sub ON sub.id = se.subject_id
     WHERE se.teacher_id = $1 AND se.school_year_id = $2
     ORDER BY gl.name, sec.name, se.start_time NULLS LAST`,
    [teacherId, schoolYearId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    roleType: row.role_type,
    subjectName: row.subject_name,
    label: `${row.subject_name} \u2014 ${describePeriod(row)}`,
  }));
}

// Deactivating/reactivating only moves the plain is_active flag.
// status ('active' | 'locked' | 'retired') is a separate, HR-ish
// idea edited on the teacher form, and retiring already has its
// own (schedule-clearing) behaviour there — the button on the
// Teachers list deliberately doesn't reach into it.
async function setTeacherActive(db, teacherId, isActive) {
  const result = await db.query(
    `UPDATE teachers SET is_active = $2, updated_at = NOW() WHERE id = $1
     RETURNING id, first_name, middle_name, last_name, email, is_active, status`,
    [teacherId, isActive]
  );
  return result.rows[0] || null;
}

/**
 * The first period that would double-book the teacher receiving a
 * transfer: one of the moving periods overlapping, on a shared day,
 * with something that teacher already has. Returns both sides so
 * the refusal can name them.
 */
async function findTransferClash(db, fromTeacherId, toTeacherId, schoolYearId) {
  const result = await db.query(
    `SELECT msub.name AS moving_subject_name, mgl.name AS moving_grade_level_name,
            msec.name AS moving_section_name, moving.days AS moving_days,
            moving.start_time AS moving_start_time, moving.end_time AS moving_end_time,
            tsub.name AS target_subject_name, tgl.name AS target_grade_level_name,
            tsec.name AS target_section_name, target.days AS target_days,
            target.start_time AS target_start_time, target.end_time AS target_end_time
     FROM schedule_entries moving
     JOIN sections msec ON msec.id = moving.section_id
     JOIN grade_levels mgl ON mgl.id = msec.grade_level_id
     LEFT JOIN subjects msub ON msub.id = moving.subject_id
     JOIN schedule_entries target
       ON target.teacher_id = $2
      AND target.school_year_id = moving.school_year_id
      AND target.role_type = 'subject'
      AND target.days && moving.days
      AND target.start_time < moving.end_time
      AND target.end_time > moving.start_time
     JOIN sections tsec ON tsec.id = target.section_id
     JOIN grade_levels tgl ON tgl.id = tsec.grade_level_id
     LEFT JOIN subjects tsub ON tsub.id = target.subject_id
     WHERE moving.teacher_id = $1 AND moving.school_year_id = $3 AND moving.role_type = 'subject'
     ORDER BY moving.start_time
     LIMIT 1`,
    [fromTeacherId, toTeacherId, schoolYearId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    moving: describePeriod({
      grade_level_name: row.moving_grade_level_name, section_name: row.moving_section_name,
      days: row.moving_days, start_time: row.moving_start_time, end_time: row.moving_end_time,
    }),
    movingSubject: row.moving_subject_name || 'Class',
    existing: describePeriod({
      grade_level_name: row.target_grade_level_name, section_name: row.target_section_name,
      days: row.target_days, start_time: row.target_start_time, end_time: row.target_end_time,
    }),
    existingSubject: row.target_subject_name || 'Class',
  };
}

// A period is "untouched since the hand-over" only if it is still the
// same period: same section, same days, same start and end. Times come
// back from Postgres as 'HH:MM:SS' strings and the day array's order is
// not meaningful, so both are normalised before being compared.
const timeKey = (value) => (value == null ? null : String(value).slice(0, 8));
const daysKey = (value) => [...(value || [])].map(Number).sort((a, b) => a - b).join(',');

// Two periods double-book one teacher when they share a day and their
// times overlap. An adviser role has no time of its own, so it can never
// clash with anything.
function periodsOverlap(a, b) {
  if (!a.start_time || !b.start_time) return false;
  const aDays = new Set((a.days || []).map(Number));
  if (!(b.days || []).some((d) => aDays.has(Number(d)))) return false;
  return timeKey(a.start_time) < timeKey(b.end_time) && timeKey(a.end_time) > timeKey(b.start_time);
}

/**
 * Moves EVERY schedule entry this teacher has in the given school
 * year over to another teacher, and gives the receiving teacher the
 * teacher_subjects links those periods need so the subject they are
 * now teaching also shows up on their own record.
 *
 * The hand-over is also written down (teacher_schedule_transfers) so
 * that activating the teacher again can offer to undo exactly this:
 * every entry is snapshotted as it was at this moment, and the only
 * subject links recorded are the ones this transfer actually created
 * (ON CONFLICT ... RETURNING returns the inserted rows only), so
 * undoing it never takes away a subject the receiving teacher already
 * had on their own record.
 */
async function transferSchedule(db, fromTeacherId, toTeacherId, schoolYearId, createdBy = null) {
  const moved = await db.query(
    `UPDATE schedule_entries SET teacher_id = $2, updated_at = NOW()
     WHERE teacher_id = $1 AND school_year_id = $3
     RETURNING id, subject_id, section_id, role_type, days, start_time, end_time`,
    [fromTeacherId, toTeacherId, schoolYearId]
  );
  const subjectIds = [...new Set(moved.rows.map((r) => r.subject_id).filter((v) => v != null))];
  let linkedSubjectIds = [];
  if (subjectIds.length > 0) {
    const linked = await db.query(
      `INSERT INTO teacher_subjects (teacher_id, subject_id)
       SELECT $1, s FROM unnest($2::int[]) AS s ON CONFLICT DO NOTHING
       RETURNING subject_id`,
      [toTeacherId, subjectIds]
    );
    linkedSubjectIds = linked.rows.map((r) => Number(r.subject_id));
  }

  if (moved.rowCount > 0) {
    const snapshot = moved.rows.map((r) => ({
      id: String(r.id),
      sectionId: r.section_id,
      subjectId: r.subject_id,
      roleType: r.role_type,
      days: (r.days || []).map(Number),
      startTime: timeKey(r.start_time),
      endTime: timeKey(r.end_time),
    }));
    await db.query(
      `INSERT INTO teacher_schedule_transfers
         (from_teacher_id, to_teacher_id, school_year_id, entry_ids, subject_ids, entries, created_by)
       VALUES ($1, $2, $3, $4::bigint[], $5::int[], $6::jsonb, $7)`,
      [
        fromTeacherId, toTeacherId, schoolYearId,
        moved.rows.map((r) => String(r.id)), linkedSubjectIds,
        JSON.stringify(snapshot), createdBy,
      ]
    );
  }
  return { movedCount: moved.rowCount, subjectIds, linkedSubjectIds };
}

// Puts a readable label on every snapshotted period, by name, even for
// one whose schedule entry has since been deleted — the snapshot only
// holds ids, and the admin needs to read "Mathematics - Grade 1 -
// Alpha Mon/Wed 08:00-09:00".
async function labelSnapshot(db, entries) {
  const sectionIds = [...new Set(entries.map((e) => Number(e.sectionId)).filter(Boolean))];
  const subjectIds = [...new Set(entries.map((e) => Number(e.subjectId)).filter(Boolean))];
  const sections = sectionIds.length === 0 ? { rows: [] } : await db.query(
    `SELECT sec.id, sec.name AS section_name, gl.name AS grade_level_name
     FROM sections sec JOIN grade_levels gl ON gl.id = sec.grade_level_id
     WHERE sec.id = ANY($1::int[])`,
    [sectionIds]
  );
  const subjects = subjectIds.length === 0 ? { rows: [] } : await db.query(
    'SELECT id, name FROM subjects WHERE id = ANY($1::int[])', [subjectIds]
  );
  const sectionOf = new Map(sections.rows.map((r) => [String(r.id), r]));
  const subjectOf = new Map(subjects.rows.map((r) => [String(r.id), r.name]));
  return entries.map((e) => {
    const sec = sectionOf.get(String(e.sectionId));
    const subjectName = subjectOf.get(String(e.subjectId))
      || (e.roleType === 'adviser' ? 'Adviser (all subjects)' : 'Class');
    const where = describePeriod({
      grade_level_name: sec ? sec.grade_level_name : 'Grade level',
      section_name: sec ? sec.section_name : 'section',
      days: e.days, start_time: e.startTime, end_time: e.endTime,
    });
    return { ...e, subjectName, label: `${subjectName} \u2014 ${where}` };
  });
}

/**
 * The hand-over this teacher is still waiting to get back: the most
 * recent transfer away from them, in the given school year, that has
 * not been undone yet. null when there is nothing to offer.
 */
async function getPendingTransfer(teacherId, schoolYearId, db = pool) {
  if (!schoolYearId) return null;
  const { rows } = await db.query(
    `SELECT tr.id, tr.to_teacher_id, tr.subject_ids, tr.entries, tr.created_at,
            t.first_name, t.last_name
     FROM teacher_schedule_transfers tr
     JOIN teachers t ON t.id = tr.to_teacher_id
     WHERE tr.from_teacher_id = $1 AND tr.school_year_id = $2 AND tr.restored_at IS NULL
     ORDER BY tr.created_at DESC, tr.id DESC
     LIMIT 1`,
    [teacherId, schoolYearId]
  );
  const row = rows[0];
  if (!row) return null;
  const entries = await labelSnapshot(db, Array.isArray(row.entries) ? row.entries : []);
  return {
    id: Number(row.id),
    toTeacherId: Number(row.to_teacher_id),
    toTeacherName: `${row.first_name} ${row.last_name}`,
    subjectIds: (row.subject_ids || []).map(Number),
    transferredAt: row.created_at,
    entries,
    count: entries.length,
  };
}

/**
 * Hands back what was handed over.
 *
 * Only a period that is still EXACTLY as it was moved comes back: same
 * section, same days, same start and end time, and still held by the
 * teacher it was moved to. One that was edited, deleted or moved on
 * again since is left where it is and reported as skipped. A period
 * that would double-book the returning teacher (same day, overlapping
 * time, against something they already hold) is refused, named, and
 * also left where it is; everything else still comes back.
 */
async function restoreTransfer(db, teacherId, schoolYearId) {
  const pending = await getPendingTransfer(teacherId, schoolYearId, db);
  if (!pending) return null;

  const ids = pending.entries.map((e) => String(e.id));
  const { rows: current } = ids.length === 0 ? { rows: [] } : await db.query(
    `SELECT id, teacher_id, section_id, subject_id, role_type, days, start_time, end_time
     FROM schedule_entries WHERE id = ANY($1::bigint[]) AND school_year_id = $2`,
    [ids, schoolYearId]
  );
  const byId = new Map(current.map((r) => [String(r.id), r]));

  const eligible = [];
  const skipped = [];
  for (const entry of pending.entries) {
    const row = byId.get(String(entry.id));
    if (!row) {
      skipped.push({ label: entry.label, reason: 'deleted', note: 'that period no longer exists' });
      continue;
    }
    if (Number(row.teacher_id) !== pending.toTeacherId) {
      skipped.push({
        label: entry.label, reason: 'moved_on',
        note: `it is no longer ${pending.toTeacherName}\u2019s period`,
      });
      continue;
    }
    const sameSlot = Number(row.section_id) === Number(entry.sectionId)
      && daysKey(row.days) === daysKey(entry.days)
      && timeKey(row.start_time) === timeKey(entry.startTime)
      && timeKey(row.end_time) === timeKey(entry.endTime);
    if (!sameSlot) {
      skipped.push({ label: entry.label, reason: 'edited', note: 'it has been changed since the transfer' });
      continue;
    }
    eligible.push({ ...entry, row });
  }

  // Everything the returning teacher already holds that is NOT part of
  // this hand-over — what a period coming back could collide with.
  const { rows: held } = await db.query(
    `SELECT se.id, se.days, se.start_time, se.end_time,
            gl.name AS grade_level_name, sec.name AS section_name, sub.name AS subject_name
     FROM schedule_entries se
     JOIN sections sec ON sec.id = se.section_id
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     LEFT JOIN subjects sub ON sub.id = se.subject_id
     WHERE se.teacher_id = $1 AND se.school_year_id = $2 AND se.role_type = 'subject'
       AND NOT (se.id = ANY($3::bigint[]))`,
    [teacherId, schoolYearId, ids.length === 0 ? ['0'] : ids]
  );

  const clashes = [];
  const restoring = [];
  for (const entry of eligible) {
    const hit = held.find((h) => periodsOverlap(h, entry.row));
    if (hit) {
      clashes.push({
        label: entry.label,
        moving: describePeriod(entry.row),
        movingSubject: entry.subjectName,
        existing: describePeriod(hit),
        existingSubject: hit.subject_name || 'Class',
      });
      continue;
    }
    restoring.push(entry);
    held.push(entry.row);
  }

  if (restoring.length > 0) {
    await db.query(
      'UPDATE schedule_entries SET teacher_id = $1, updated_at = NOW() WHERE id = ANY($2::bigint[])',
      [teacherId, restoring.map((e) => String(e.id))]
    );
    const subjectIds = [...new Set(restoring.map((e) => e.subjectId).filter((v) => v != null))].map(Number);
    if (subjectIds.length > 0) {
      await db.query(
        `INSERT INTO teacher_subjects (teacher_id, subject_id)
         SELECT $1, s FROM unnest($2::int[]) AS s ON CONFLICT DO NOTHING`,
        [teacherId, subjectIds]
      );
    }
    // The subject links the hand-over itself created are given up again,
    // but only where the receiving teacher has no period of that subject
    // left — a subject they were already qualified for, or still teach,
    // stays on their record.
    if (pending.subjectIds.length > 0) {
      await db.query(
        `DELETE FROM teacher_subjects ts
         WHERE ts.teacher_id = $1 AND ts.subject_id = ANY($2::int[])
           AND NOT EXISTS (
             SELECT 1 FROM schedule_entries se
             WHERE se.teacher_id = $1 AND se.subject_id = ts.subject_id AND se.school_year_id = $3
           )`,
        [pending.toTeacherId, pending.subjectIds, schoolYearId]
      );
    }
  }

  // A hand-over blocked only by a clash stays open, so the admin can fix
  // the timetable and try again. Once nothing is in the way any more it is
  // closed and never offered again.
  if (clashes.length === 0) {
    await db.query('UPDATE teacher_schedule_transfers SET restored_at = NOW() WHERE id = $1', [pending.id]);
  }

  return {
    transferId: pending.id,
    toTeacherId: pending.toTeacherId,
    toTeacherName: pending.toTeacherName,
    transferredCount: pending.count,
    restoredCount: restoring.length,
    restored: restoring.map((e) => e.label),
    skipped,
    clashes,
    stillPending: clashes.length > 0,
  };
}

async function updateTeacher(db, id, fields) {
  if (fields.maxPeriodsPerDay !== undefined) {
    const activeYear = await getActiveSchoolYear();
    if (activeYear) {
      const busiest = await getBusiestDayCount(id, activeYear.id);
      if (fields.maxPeriodsPerDay < busiest) {
        const err = new Error(
          `This teacher already has ${busiest} periods on their busiest day. `
          + `Remove some of their scheduled classes before lowering the limit below ${busiest}.`
        );
        err.status = 409;
        throw err;
      }
    }
  }

  const sets = [];
  const params = [id];
  const key = process.env.ENCRYPTION_KEY;

  // Whether a teacher is still teaching is not editable from here: it is
  // changed by the Deactivate button, which first hands their classes over.
  // The validator drops isActive and status before this point; they are
  // ignored again here so a stray field can never reach the column.
  const plain = {
    first_name: fields.firstName, middle_name: fields.middleName, last_name: fields.lastName,
    email: fields.email, degree: fields.degree, major: fields.major, date_hired: fields.dateHired,
    sex: fields.sex, prc_license_number: fields.prcLicenseNumber, max_periods_per_day: fields.maxPeriodsPerDay,
  };
  for (const [col, val] of Object.entries(plain)) {
    if (val !== undefined) {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (fields.contactNumber !== undefined) {
    params.push(fields.contactNumber, key);
    sets.push(`contact_number = pgp_sym_encrypt($${params.length - 1}::text, $${params.length})`);
  }
  if (fields.address !== undefined) {
    params.push(fields.address, key);
    sets.push(`address = pgp_sym_encrypt($${params.length - 1}::text, $${params.length})`);
  }
  if (sets.length === 0) return { ...(await getTeacherById(id)), clearedSchedules: 0 };

  sets.push('updated_at = NOW()');
  const result = await db.query(
    `UPDATE teachers SET ${sets.join(', ')} WHERE id = $1 RETURNING id`,
    params
  );
  if (!result.rows[0]) return null;

  // Nothing is deleted here. A teacher who stops teaching goes through the
  // hand-over behind the Deactivate button, which moves each class to somebody
  // who can take it. Wiping their rows instead would take last year's master
  // lists and class records with them — the school has to be able to answer
  // "who taught this child last year?" long after the teacher has left.
  return { ...result.rows[0], clearedSchedules: 0 };
}

async function getTeacherWeeklySchedule(teacherId, schoolYearId) {
  const result = await pool.query(
    `SELECT se.id, se.section_id, se.session, se.days, se.start_time, se.end_time, se.room, se.role_type,
            sub.name AS subject_name, sec.name AS section_name, gl.name AS grade_level_name
     FROM schedule_entries se
     JOIN sections sec ON sec.id = se.section_id
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     LEFT JOIN subjects sub ON sub.id = se.subject_id
     WHERE se.teacher_id = $1 AND se.school_year_id = $2
     ORDER BY se.start_time NULLS LAST`,
    [teacherId, schoolYearId]
  );
  return result.rows;
}

/* ---------------------------------------------------------------------------
 * Handing a teacher's work over before they are deactivated.
 *
 * A teacher who stops teaching leaves two things behind: the sections they
 * advise, and the subjects they teach. Both have to go to somebody, and not to
 * just anybody:
 *
 *   - a subject may only go to a teacher qualified to teach it (the subject is
 *     in their list), because the timetable is also a statement about who is
 *     competent to stand in front of that class;
 *   - it may only go to a teacher who still has room on each of the days it
 *     runs, counted against their own maximum periods per day — a hand-over
 *     that pushes somebody over their limit is not a hand-over, it is a
 *     problem moved;
 *   - and it may not go to a teacher already teaching at that hour.
 *
 * Each subject is handed over separately, so one teacher's load can be split
 * between several colleagues rather than being dropped on one.
 * ------------------------------------------------------------------------- */

/** Everything this teacher does that somebody else would have to take on. */
async function getHandoverWork(teacherId, schoolYearId, db = pool) {
  if (!schoolYearId) return { advisories: [], subjects: [] };

  const { rows: advisories } = await db.query(
    `SELECT sec.id AS section_id, sec.name AS section_name, gl.name AS grade_level_name
       FROM sections sec
       JOIN grade_levels gl ON gl.id = sec.grade_level_id
      WHERE sec.adviser_teacher_id = $1 AND sec.school_year_id = $2
      ORDER BY gl.sort_order, sec.name`,
    [teacherId, schoolYearId]
  );

  // The periods they teach, grouped by subject: that is the unit handed over.
  const { rows: periods } = await db.query(
    `SELECT se.id, se.subject_id, se.days, se.start_time, se.end_time,
            sub.name AS subject_name, gl.name AS grade_level_name, sec.name AS section_name
       FROM schedule_entries se
       JOIN sections sec ON sec.id = se.section_id
       JOIN grade_levels gl ON gl.id = sec.grade_level_id
       LEFT JOIN subjects sub ON sub.id = se.subject_id
      WHERE se.teacher_id = $1 AND se.school_year_id = $2 AND se.role_type = 'subject'
      ORDER BY gl.sort_order, sec.name, se.start_time NULLS LAST`,
    [teacherId, schoolYearId]
  );

  const bySubject = new Map();
  for (const row of periods) {
    const key = String(row.subject_id || 'none');
    if (!bySubject.has(key)) {
      bySubject.set(key, {
        subjectId: row.subject_id ? Number(row.subject_id) : null,
        subjectName: row.subject_name || 'Unassigned period',
        gradeLevelName: row.grade_level_name,
        periods: [],
      });
    }
    bySubject.get(key).periods.push({
      id: String(row.id),
      days: (row.days || []).map(Number),
      startTime: timeKey(row.start_time),
      endTime: timeKey(row.end_time),
      label: `${row.subject_name || 'Period'} \u2014 ${describePeriod(row)}`,
      sectionName: row.section_name,
    });
  }

  return { advisories: advisories.map((a) => ({
    sectionId: Number(a.section_id), sectionName: a.section_name, gradeLevelName: a.grade_level_name,
  })), subjects: [...bySubject.values()] };
}

/** The teachers who could take something on, with why not when they cannot. */
async function getHandoverCandidates(teacherId, schoolYearId, work, db = pool) {
  const { rows: others } = await db.query(
    `SELECT t.id, t.first_name, t.last_name, t.max_periods_per_day,
            COALESCE(array_agg(DISTINCT ts.subject_id) FILTER (WHERE ts.subject_id IS NOT NULL), '{}') AS subject_ids
       FROM teachers t
       LEFT JOIN teacher_subjects ts ON ts.teacher_id = t.id
      WHERE t.id <> $1 AND t.is_active AND t.status = 'active'
      GROUP BY t.id
      ORDER BY t.last_name, t.first_name`,
    [teacherId]
  );

  // What each of them already teaches, so room and clashes can be counted.
  const { rows: held } = await db.query(
    `SELECT teacher_id, id, days, start_time, end_time
       FROM schedule_entries
      WHERE school_year_id = $1 AND role_type = 'subject' AND teacher_id IS NOT NULL`,
    [schoolYearId]
  );
  const heldBy = new Map();
  for (const row of held) {
    const key = String(row.teacher_id);
    if (!heldBy.has(key)) heldBy.set(key, []);
    heldBy.get(key).push(row);
  }

  // Who already advises a section: an adviser belongs to one section only.
  const { rows: advising } = await db.query(
    `SELECT sec.adviser_teacher_id AS teacher_id, sec.name AS section_name, gl.name AS grade_level_name
       FROM sections sec
       JOIN grade_levels gl ON gl.id = sec.grade_level_id
      WHERE sec.school_year_id = $1 AND sec.adviser_teacher_id IS NOT NULL`,
    [schoolYearId]
  );
  const advisingBy = new Map(advising.map((a) => [String(a.teacher_id), a]));

  const named = (t) => `${t.last_name}, ${t.first_name}`;

  const advisories = work.advisories.map((item) => ({
    ...item,
    candidates: others.map((t) => {
      const already = advisingBy.get(String(t.id));
      return {
        id: Number(t.id), name: named(t),
        eligible: !already,
        reason: already ? `already advises ${already.grade_level_name} \u2014 ${already.section_name}` : '',
      };
    }),
  }));

  const subjects = work.subjects.map((item) => {
    const movingPerDay = new Map();
    for (const p of item.periods) {
      for (const d of p.days) movingPerDay.set(d, (movingPerDay.get(d) || 0) + 1);
    }
    return {
      ...item,
      candidates: others.map((t) => {
        const qualified = item.subjectId != null
          && (t.subject_ids || []).map(Number).includes(item.subjectId);
        const theirs = heldBy.get(String(t.id)) || [];
        const clash = item.periods.find((p) => theirs.some((h) => periodsOverlap(
          { days: h.days, start_time: h.start_time, end_time: h.end_time },
          { days: p.days, start_time: p.startTime, end_time: p.endTime }
        )));
        // Their own daily limit, counted day by day with the moving periods added.
        const cap = Number(t.max_periods_per_day) || 0;
        let overDay = null;
        for (const [day, adding] of movingPerDay) {
          const current = theirs.filter((h) => (h.days || []).map(Number).includes(day)).length;
          if (current + adding > cap) { overDay = { day, current, adding, cap }; break; }
        }
        const reason = !qualified ? 'does not teach this subject'
          : clash ? `already teaching at ${clash.startTime}\u2013${clash.endTime}`
            : overDay ? `would be over their limit of ${overDay.cap} period${overDay.cap === 1 ? '' : 's'} on ${DAY_NAMES[overDay.day] || `day ${overDay.day}`}`
              : '';
        return { id: Number(t.id), name: named(t), eligible: !reason, reason };
      }),
    };
  });

  return { advisories, subjects };
}

/**
 * Carries out a hand-over: each subject to the teacher chosen for it, each
 * advisory class to the teacher chosen for it. Everything is checked again
 * here against the live data — the dialog's lists were a snapshot, and two
 * administrators can be working at the same moment.
 *
 * Runs inside the caller's transaction, so a hand-over that cannot be finished
 * leaves the timetable exactly as it was.
 */
async function performHandover(db, {
  teacherId, schoolYearId, subjectChoices = [], adviserChoices = [], createdBy = null,
}) {
  const work = await getHandoverWork(teacherId, schoolYearId, db);
  const { advisories, subjects } = await getHandoverCandidates(teacherId, schoolYearId, work, db);

  const fail = (message) => {
    throw Object.assign(new Error(message), { status: 409, reason: 'handover_invalid' });
  };

  // Nothing may be left behind: a teacher is only deactivated once every
  // class they hold has somebody else's name against it.
  const subjectBy = new Map(subjectChoices.map((c) => [String(c.subjectId), Number(c.teacherId)]));
  const adviserBy = new Map(adviserChoices.map((c) => [String(c.sectionId), Number(c.teacherId)]));

  for (const item of subjects) {
    const chosen = subjectBy.get(String(item.subjectId));
    if (!chosen) fail(`Choose who takes over ${item.subjectName} (${item.gradeLevelName}).`);
    const candidate = item.candidates.find((c) => c.id === chosen);
    if (!candidate) fail('One of the teachers chosen is no longer available. Reopen this and try again.');
    if (!candidate.eligible) fail(`${candidate.name} cannot take ${item.subjectName}: ${candidate.reason}.`);
  }
  for (const item of advisories) {
    const chosen = adviserBy.get(String(item.sectionId));
    if (!chosen) fail(`Choose the new adviser for ${item.gradeLevelName} — ${item.sectionName}.`);
    const candidate = item.candidates.find((c) => c.id === chosen);
    if (!candidate) fail('One of the teachers chosen is no longer available. Reopen this and try again.');
    if (!candidate.eligible) fail(`${candidate.name} cannot advise ${item.sectionName}: ${candidate.reason}.`);
  }

  // The subjects, one group at a time, so each lands on its own teacher.
  const movedBy = new Map(); // receiving teacher id -> what went to them
  for (const item of subjects) {
    const toTeacherId = subjectBy.get(String(item.subjectId));
    const ids = item.periods.map((p) => p.id);
    const { rows: moved } = await db.query(
      `UPDATE schedule_entries SET teacher_id = $2, updated_at = NOW()
        WHERE id = ANY($1::bigint[]) AND teacher_id = $3
        RETURNING id, subject_id, section_id, role_type, days, start_time, end_time`,
      [ids, toTeacherId, teacherId]
    );
    if (moved.length !== ids.length) {
      fail('Part of this timetable changed while the hand-over was open. Reopen it and try again.');
    }
    if (item.subjectId != null) {
      // The receiving teacher now teaches this subject, so it joins their list.
      await db.query(
        'INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [toTeacherId, item.subjectId]
      );
    }
    if (!movedBy.has(String(toTeacherId))) movedBy.set(String(toTeacherId), { rows: [], subjectIds: [] });
    const bucket = movedBy.get(String(toTeacherId));
    bucket.rows.push(...moved);
    if (item.subjectId != null) bucket.subjectIds.push(item.subjectId);
  }

  // The advisory classes.
  for (const item of advisories) {
    const toTeacherId = adviserBy.get(String(item.sectionId));
    await db.query(
      'UPDATE sections SET adviser_teacher_id = $2 WHERE id = $1 AND adviser_teacher_id = $3',
      [item.sectionId, toTeacherId, teacherId]
    );
    // Where the timetable keeps a row for the adviser role, it follows the role.
    await db.query(
      `UPDATE schedule_entries SET teacher_id = $2, updated_at = NOW()
        WHERE section_id = $1 AND school_year_id = $3 AND role_type = 'adviser' AND teacher_id = $4`,
      [item.sectionId, toTeacherId, schoolYearId, teacherId]
    );
  }

  // One record per receiving teacher, so reactivating can offer to undo it.
  for (const [toTeacherId, bucket] of movedBy) {
    const snapshot = bucket.rows.map((r) => ({
      id: String(r.id),
      sectionId: r.section_id,
      subjectId: r.subject_id,
      roleType: r.role_type,
      days: (r.days || []).map(Number),
      startTime: timeKey(r.start_time),
      endTime: timeKey(r.end_time),
    }));
    await db.query(
      `INSERT INTO teacher_schedule_transfers
         (from_teacher_id, to_teacher_id, school_year_id, entry_ids, subject_ids, entries, created_by)
       VALUES ($1, $2, $3, $4::bigint[], $5::int[], $6::jsonb, $7)`,
      [teacherId, Number(toTeacherId), schoolYearId,
        bucket.rows.map((r) => String(r.id)), bucket.subjectIds,
        JSON.stringify(snapshot), createdBy]
    );
  }

  return {
    movedCount: [...movedBy.values()].reduce((n, b) => n + b.rows.length, 0),
    subjectsHandedOver: subjects.length,
    advisoriesHandedOver: advisories.length,
    receivingTeacherIds: [...movedBy.keys()].map(Number),
  };
}

module.exports = {
  getHandoverWork, getHandoverCandidates, performHandover,
  listTeachers, getTeacherById, findTeacherByEmail, findDuplicateTeacher,
  createTeacher, updateTeacher, setTeacherSubjects, getTeacherWeeklySchedule,
  getLockedSubjects, getActiveYearAssignments, setTeacherActive,
  findTransferClash, transferSchedule, describePeriod,
  getPendingTransfer, restoreTransfer,
};