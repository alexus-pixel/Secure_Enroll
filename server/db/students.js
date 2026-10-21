const crypto = require('crypto');
const pool = require('./pool');
const { SEAT_STATUSES } = require('../lib/seats');

function lrnHash(lrn) {
  return crypto.createHash('sha256').update((lrn || '').trim()).digest('hex');
}

async function createStudent(db, {
  firstName, middleName, lastName, birthDate, sex, lrn,
}) {
  const result = await db.query(
    `INSERT INTO students (first_name, middle_name, last_name, birth_date, sex, lrn_encrypted, lrn_hash)
     VALUES ($1, $2, $3, pgp_sym_encrypt($4::text, $5), $6,
             CASE WHEN $7::text IS NOT NULL THEN pgp_sym_encrypt($7::text, $5) END,
             $8)
     RETURNING id`,
    [
      firstName, middleName || null, lastName, birthDate, process.env.ENCRYPTION_KEY, sex,
      lrn || null, lrn ? lrnHash(lrn) : null,
    ]
  );
  return result.rows[0].id;
}

// Scoped on purpose: this can only ever find a student already linked to
// THIS guardian's account. Without that join, an LRN search would let any
// parent look up any other family's child just by guessing/typing a
// number -- LRNs aren't secret the way a password is, so this must not be
// an open lookup. It also pulls the student's most recent application, so
// the UI can show what grade they're being promoted into.
async function findReturningStudentForGuardian(lrn, guardianId) {
  const result = await pool.query(
    `SELECT s.id, s.first_name, s.middle_name, s.last_name, s.sex,
            cur_gl.name AS current_grade, cur_gl.sort_order AS current_sort_order,
            cur_sy.label AS current_school_year,
            next_gl.id AS next_grade_level_id, next_gl.name AS next_grade_level_name
     FROM students s
     JOIN student_guardians sg ON sg.student_id = s.id
     JOIN LATERAL (
       SELECT ea.grade_level_id, ea.school_year_id
       FROM enrollment_applications ea
       WHERE ea.student_id = s.id
       ORDER BY ea.submitted_at DESC LIMIT 1
     ) latest_app ON true
     JOIN grade_levels cur_gl ON cur_gl.id = latest_app.grade_level_id
     JOIN school_years cur_sy ON cur_sy.id = latest_app.school_year_id
     LEFT JOIN grade_levels next_gl ON next_gl.sort_order = cur_gl.sort_order + 1
     WHERE s.lrn_hash = $1 AND sg.guardian_id = $2`,
    [lrnHash(lrn), guardianId]
  );
  return result.rows[0] || null;
}

async function guardianOwnsStudent(guardianId, studentId) {
  const result = await pool.query(
    `SELECT 1 FROM student_guardians WHERE student_id = $1 AND guardian_id = $2`,
    [studentId, guardianId]
  );
  return result.rows.length > 0;
}

// Birth certificate and good-moral-character don't change year to year,
// so once one is on file for a student it stays valid for every later
// application. Form 138 (report card) is inherently tied to the grade the
// student is being promoted FROM, so it's excluded here -- always required
// fresh at promotion time, never treated as "already on file".
const CARRIES_OVER = ['birth_certificate', 'good_moral'];

async function getDocumentsOnFileForStudent(studentId) {
  const result = await pool.query(
    `SELECT DISTINCT d.doc_type FROM documents d
     JOIN enrollment_applications ea ON ea.id = d.application_id
     WHERE ea.student_id = $1 AND d.doc_type = ANY($2::text[])`,
    [studentId, CARRIES_OVER]
  );
  return result.rows.map((r) => r.doc_type);
}

// Only ever fills in a currently-blank LRN -- the WHERE guard means this
// silently affects 0 rows (rather than clobbering a correct value) if one
// is already on file, so the caller can tell the two cases apart.
/**
 * The learner this LRN already belongs to, or null. An LRN identifies one
 * child in DepEd's register, so it may appear against one record and no more.
 */
async function findStudentByLrn(lrn, db = pool) {
  if (!lrn) return null;
  const { rows } = await db.query(
    'SELECT id, first_name, middle_name, last_name FROM students WHERE lrn_hash = $1 LIMIT 1',
    [lrnHash(lrn)]
  );
  return rows[0] || null;
}

async function addLrnIfMissing(studentId, lrn) {
  // Somebody else may already hold it: the column is unique, but a clear
  // sentence beats a constraint violation surfacing as a server error.
  // The holder is never named in that sentence: a parent could otherwise
  // type any LRN here and read back whose child it belongs to.
  const owner = await findStudentByLrn(lrn);
  if (owner && String(owner.id) !== String(studentId)) {
    throw Object.assign(
      new Error(`That LRN is already on file. Check the LRN on the learner's Form 137.`),
      { status: 409, reason: 'duplicate_lrn' }
    );
  }
  const result = await pool.query(
    `UPDATE students
     SET lrn_encrypted = pgp_sym_encrypt($2::text, $3), lrn_hash = $4,
         lrn_flagged_at = NULL, lrn_flag_note = NULL, lrn_flagged_by = NULL, updated_at = NOW()
     WHERE id = $1 AND lrn_hash IS NULL
     RETURNING id`,
    [studentId, lrn, process.env.ENCRYPTION_KEY, lrnHash(lrn)]
  );
  return result.rows.length > 0;
}

/**
 * Finds a learner already on file under the same name.
 *
 * A learner's name has to be unique across the whole school, not within one
 * grade level: two records reading "Librando, Alexandra Keith" — one in Kinder,
 * one in Grade 6 — cannot be told apart on a master list, a schedule or a
 * class record, so the second one is refused.
 *
 * The comparison ignores case, leading and trailing spaces, and repeated
 * spaces inside the name. A different middle name makes it a different
 * learner, which is how two children who share a first and last name are
 * still both allowed.
 */
async function findStudentByFullName({ firstName, middleName, lastName }, db = pool) {
  const norm = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const first = norm(firstName);
  const last = norm(lastName);
  const middle = norm(middleName);
  if (!first || !last) return null;

  const { rows } = await db.query(
    `SELECT s.id, s.first_name, s.middle_name, s.last_name,
            gl.name AS grade_level_name, sec.name AS section_name,
            sy.label AS school_year_label, ea.status
     FROM students s
     LEFT JOIN LATERAL (
       SELECT ea.grade_level_id, ea.section_id, ea.school_year_id, ea.status
       FROM enrollment_applications ea
       WHERE ea.student_id = s.id
       ORDER BY ea.id DESC LIMIT 1
     ) ea ON TRUE
     LEFT JOIN grade_levels gl ON gl.id = ea.grade_level_id
     LEFT JOIN sections sec ON sec.id = ea.section_id
     LEFT JOIN school_years sy ON sy.id = ea.school_year_id
     WHERE lower(regexp_replace(btrim(s.first_name), '\\s+', ' ', 'g')) = $1
       AND lower(regexp_replace(btrim(s.last_name), '\\s+', ' ', 'g')) = $2
       AND lower(regexp_replace(btrim(COALESCE(s.middle_name, '')), '\\s+', ' ', 'g')) = $3
     ORDER BY s.id LIMIT 1`,
    [first, last, middle]
  );
  return rows[0] || null;
}

/** The sentence shown when that name is already taken. */
function duplicateNameMessage(student) {
  const name = [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' ');
  const where = student.grade_level_name
    ? ` (currently ${student.grade_level_name}${student.section_name ? `, ${student.section_name}` : ''}${student.school_year_label ? `, SY ${student.school_year_label}` : ''})`
    : '';
  return `A learner named ${name} is already on file${where}. Two learners cannot share the same name, even in different grade levels. `
    + 'If this is the same child, enroll them as a returning student; if it is a different child, add a middle name to tell them apart.';
}

/**
 * The application this learner already holds in the school year enrollment is
 * running for, or null.
 *
 * A learner sits in one grade level in one school year, so a transferee or a
 * returnee whose LRN is already enrolled for the current year is not enrolling
 * again — they are already in. Withdrawn and rejected applications do not
 * count, because those learners genuinely are not enrolled; everything from
 * "submitted" up to "approved" does (SEAT_STATUSES in lib/seats.js), since
 * each of those is holding a seat.
 *
 * Checked at the LRN lookup, so the front desk and the parent are told before
 * anything is typed, rather than meeting a unique-constraint error at the end
 * of the form.
 */
async function activeYearEnrollment(studentId, db = pool) {
  if (!studentId) return null;
  const { rows } = await db.query(
    `SELECT ea.id, ea.status, ea.submitted_at,
            gl.name AS grade_name, sec.name AS section_name, sy.label AS school_year_label
       FROM enrollment_applications ea
       JOIN school_years sy ON sy.id = ea.school_year_id
       JOIN grade_levels gl ON gl.id = ea.grade_level_id
       LEFT JOIN sections sec ON sec.id = ea.section_id
      WHERE ea.student_id = $1 AND sy.is_active AND ea.status = ANY($2::text[])
      ORDER BY ea.submitted_at DESC LIMIT 1`,
    [studentId, SEAT_STATUSES]
  );
  return rows[0] || null;
}

/**
 * The sentence shown when that learner is already enrolled for this year.
 * `audience` is 'parent' or 'staff' — the facts are the same, what to do
 * about it is not.
 */
function alreadyEnrolledMessage(found, name = '', audience = 'parent') {
  const who = name || 'That learner';
  const year = found.school_year_label ? `School Year ${found.school_year_label}` : 'the current school year';
  const where = found.section_name ? `${found.grade_name} - ${found.section_name}` : found.grade_name;
  if (found.status === 'approved') {
    return `${who} is already enrolled in ${where} for ${year}, so there is nothing left to enroll. `
      + (audience === 'staff'
        ? 'Open the learner from the enrollment list to change their grade level or section.'
        : 'You can see the enrollment on your dashboard.');
  }
  return `${who} already has an application for ${where} in ${year}, and it is still being reviewed. `
    + (audience === 'staff'
      ? 'Wait for that one to be decided, or withdraw it first.'
      : 'Wait for the school to decide on that one before applying again.');
}

module.exports = {
  lrnHash, createStudent, findReturningStudentForGuardian, guardianOwnsStudent,
  getDocumentsOnFileForStudent, addLrnIfMissing, findStudentByLrn,
  findStudentByFullName, duplicateNameMessage,
  activeYearEnrollment, alreadyEnrolledMessage,
};
