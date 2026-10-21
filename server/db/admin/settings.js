const pool = require('../pool');
const { gradeSeats, enrollmentIsFull } = require('../../lib/seats');

/**
 * Keeps school_years.enrollment_closed_at in step with whether enrollment is
 * actually closed right now.
 *
 * Enrollment can stop for three different reasons — the window ran out, every
 * slot filled, or an administrator switched it off — and only the third one
 * passes through a button. So rather than stamping the date in each of those
 * places, the stamp is set the first time the system sees enrollment closed,
 * and cleared the first time it sees it open again. Whoever reads the year
 * next is what makes it happen, which is enough: nothing shows the date
 * without reading the year first.
 *
 * `db` so it can run inside a transaction that just changed the switch.
 */
async function syncEnrollmentClosure(year, isClosed, db = pool) {
  if (!year) return year;
  if (isClosed && !year.enrollment_closed_at) {
    const { rows: [row] } = await db.query(
      `UPDATE school_years SET enrollment_closed_at = NOW()
        WHERE id = $1 AND enrollment_closed_at IS NULL
        RETURNING enrollment_closed_at`,
      [year.id]
    );
    if (row) year.enrollment_closed_at = row.enrollment_closed_at;
  } else if (!isClosed && year.enrollment_closed_at) {
    await db.query(
      'UPDATE school_years SET enrollment_closed_at = NULL WHERE id = $1', [year.id]
    );
    year.enrollment_closed_at = null;
  }
  return year;
}

async function getActiveSchoolYear() {
  const result = await pool.query(
    `SELECT id, label, opens_at, closes_at, classes_start_on::text AS classes_start_on, is_active,
            enrollment_open, dates_confirmed, enrollment_closed_at
     FROM school_years WHERE is_active = TRUE LIMIT 1`
  );
  const year = result.rows[0] || null;
  if (!year) return null;
  // Enrollment closes by itself once every slot of every grade level is filled.
  year.slots_full = await enrollmentIsFull(pool, year.id);
  // Whether it is closed is the same question computeEnrollment() answers, and
  // the answer is the same three things: the window, the switch, the slots.
  const closed = !year.enrollment_open
    || year.slots_full
    || !withinWindow(year);
  await syncEnrollmentClosure(year, closed);
  return year;
}

/** Today, in Philippine time, inside this year's enrollment window. */
function withinWindow(year) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const day = (value) => (value
    ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(value instanceof Date ? value : new Date(value))
    : null);
  const opens = day(year.opens_at);
  const closes = day(year.closes_at);
  if (opens && today < opens) return false;
  if (closes && today > closes) return false;
  return true;
}

async function updateEnrollmentPeriod(schoolYearId, { enrollmentOpen, opensAt, closesAt }) {
  // These are the school year's own dates, so the same rule applies here as in
  // School Settings: once the year has begun, the day it began on is a matter
  // of record and every schedule, master list and approved application filed
  // under it depends on the year's name, which comes from that date.
  const { rows: [year] } = await pool.query(
    `SELECT label, classes_start_on::text AS classes_start_on,
            (opens_at AT TIME ZONE 'Asia/Manila')::date::text AS opens_at,
            ((opens_at AT TIME ZONE 'Asia/Manila')::date
               <= (NOW() AT TIME ZONE 'Asia/Manila')::date) AS has_started
       FROM school_years WHERE id = $1`,
    [schoolYearId]
  );
  if (!year) return null;
  if (year.has_started && opensAt && opensAt !== year.opens_at) {
    throw Object.assign(
      new Error(`School year ${year.label} has already begun, so its opening date can no longer be moved. You can still change the closing date.`),
      { status: 409, reason: 'school_year_started' }
    );
  }
  const finalOpensAt = year.has_started ? year.opens_at : (opensAt || year.opens_at);
  if (closesAt <= finalOpensAt) {
    throw Object.assign(
      new Error('The closing date has to be after the opening date.'),
      { status: 400 }
    );
  }
  // The enrollment window cannot be stretched past the first day of classes:
  // enrollment has to shut on or before the children walk in.
  if (year.classes_start_on && closesAt > year.classes_start_on) {
    throw Object.assign(
      new Error('The enrollment period has to end on or before the first day of classes.'),
      { status: 400, reason: 'enrollment_past_classes_start' }
    );
  }
  const result = await pool.query(
    `UPDATE school_years SET enrollment_open = $2,
         opens_at = ($3::date)::timestamp AT TIME ZONE 'Asia/Manila',
         closes_at = ($4::date)::timestamp AT TIME ZONE 'Asia/Manila',
         -- The day enrollment stopped is recorded the moment the switch goes
         -- off, and forgotten again when it goes back on, so the page can say
         -- "closed on ..." with the date it really happened rather than the
         -- date it was planning to.
         enrollment_closed_at = CASE
           WHEN $2 = FALSE THEN COALESCE(enrollment_closed_at, NOW())
           ELSE NULL
         END
     WHERE id = $1
     RETURNING id, label, opens_at, closes_at, enrollment_open, enrollment_closed_at`,
    [schoolYearId, enrollmentOpen, finalOpensAt, closesAt]
  );
  return result.rows[0] || null;
}

/**
 * "Grade level configuration, slots are based on slots per
 * section" — so the per-grade number shown on System Settings is a
 * read-only sum of that grade's own sections, not a separately
 * stored value. The actual capacity per section is edited from
 * School Settings' Manage popup; this just reports the total plus
 * how many of those seats are already spoken for.
 */
async function getGradeLevelSlotSummary(schoolYearId) {
  // The same seat rule as every other page (lib/seats.js).
  const seats = await gradeSeats(pool, schoolYearId);
  return seats.map((g) => ({
    id: g.id, name: g.name, sort_order: g.sortOrder,
    total_slots: g.capacity, enrolled_count: g.taken, slots_left: g.left,
    section_count: g.sectionCount, waiting: g.waiting,
  }));
}

async function getRequiredDocuments() {
  const result = await pool.query(
    'SELECT id, code, label, is_required, applies_to FROM required_document_types ORDER BY sort_order'
  );
  return result.rows;
}

async function updateRequiredDocuments(documents) {
  // documents: [{ id, isRequired, appliesTo }]. One statement per row inside a
  // transaction, not a loop of independent queries, so a failure
  // partway through never leaves the checklist half-saved. `appliesTo` says
  // which kind of enrollment asks for the document — a new learner, a
  // returning one, or both — and is left as it stands when it is not sent.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const doc of documents) {
      await client.query(
        `UPDATE required_document_types
            SET is_required = $2,
                applies_to = COALESCE($3, applies_to)
          WHERE id = $1`,
        [doc.id, doc.isRequired, ['all', 'new', 'returning'].includes(doc.appliesTo) ? doc.appliesTo : null]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getRequiredDocuments();
}

/**
 * The code a new document type is filed under: the label, lowercased, with
 * anything that is not a letter or digit turned into an underscore. It is what
 * every document row stores, so it is made once and never changed afterwards —
 * renaming the label leaves the code alone.
 */
function codeFromLabel(label) {
  const base = String(label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36);
  return base || 'document';
}

/** Adds a document type. The label must be one the school does not already have. */
async function addRequiredDocument({ label, isRequired = true }) {
  const name = String(label).trim().replace(/\s+/g, ' ');
  const { rows: [clash] } = await pool.query(
    'SELECT id FROM required_document_types WHERE lower(btrim(label)) = lower($1)', [name]
  );
  if (clash) {
    throw Object.assign(new Error(`There is already a document called "${name}".`), { status: 409 });
  }
  // The code has to be unique too, and two different labels can reduce to the
  // same one ("Form 138" and "Form-138"), so a number is added until it is free.
  const base = codeFromLabel(name);
  let code = base;
  for (let n = 2; n < 50; n += 1) {
    const { rowCount } = await pool.query('SELECT 1 FROM required_document_types WHERE code = $1', [code]);
    if (!rowCount) break;
    code = `${base}_${n}`;
  }
  const { rows: [{ next }] } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM required_document_types'
  );
  const { rows: [created] } = await pool.query(
    `INSERT INTO required_document_types (code, label, is_required, sort_order)
     VALUES ($1, $2, $3, $4) RETURNING id, code, label, is_required, sort_order`,
    [code, name, isRequired, next]
  );
  return created;
}

/** Renames a document type, or changes whether it is required. */
async function updateRequiredDocument(id, { label, isRequired }) {
  const { rows: [existing] } = await pool.query(
    'SELECT id, code, label FROM required_document_types WHERE id = $1', [id]
  );
  if (!existing) throw Object.assign(new Error('That document type was not found.'), { status: 404 });

  if (label !== undefined) {
    const name = String(label).trim().replace(/\s+/g, ' ');
    const { rows: [clash] } = await pool.query(
      'SELECT id FROM required_document_types WHERE lower(btrim(label)) = lower($1) AND id <> $2', [name, id]
    );
    if (clash) {
      throw Object.assign(new Error(`There is already a document called "${name}".`), { status: 409 });
    }
    // The code stays as it is: every document already uploaded is filed under
    // it, and changing it would orphan them.
    await pool.query('UPDATE required_document_types SET label = $2 WHERE id = $1', [id, name]);
  }
  if (isRequired !== undefined) {
    await pool.query('UPDATE required_document_types SET is_required = $2 WHERE id = $1', [id, isRequired]);
  }
  const { rows: [row] } = await pool.query(
    'SELECT id, code, label, is_required, sort_order FROM required_document_types WHERE id = $1', [id]
  );
  return row;
}

/**
 * Removes a document type. Refused once anything has been filed under it,
 * because those rows would have nothing to describe them afterwards — such a
 * document is unticked instead, which stops it being asked for from now on.
 */
async function deleteRequiredDocument(id) {
  const { rows: [existing] } = await pool.query(
    'SELECT id, code, label FROM required_document_types WHERE id = $1', [id]
  );
  if (!existing) throw Object.assign(new Error('That document type was not found.'), { status: 404 });

  const { rows: [{ used }] } = await pool.query(
    'SELECT COUNT(*)::int AS used FROM documents WHERE doc_type = $1', [existing.code]
  );
  if (used > 0) {
    throw Object.assign(
      new Error(`${existing.label} cannot be removed: ${used} ${used === 1 ? 'learner has' : 'learners have'} already submitted it. Untick it instead — it will stop being asked for, and the records stay readable.`),
      { status: 409, reason: 'document_in_use' }
    );
  }
  await pool.query('DELETE FROM required_document_types WHERE id = $1', [id]);
  return existing;
}

module.exports = {
  getActiveSchoolYear, updateEnrollmentPeriod, getGradeLevelSlotSummary, syncEnrollmentClosure,
  getRequiredDocuments, updateRequiredDocuments,
  addRequiredDocument, updateRequiredDocument, deleteRequiredDocument, codeFromLabel,
};
