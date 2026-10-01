const crypto = require('crypto');
const pool = require('./pool');

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
async function addLrnIfMissing(studentId, lrn) {
  const result = await pool.query(
    `UPDATE students
     SET lrn_encrypted = pgp_sym_encrypt($2::text, $3), lrn_hash = $4
     WHERE id = $1 AND lrn_hash IS NULL
     RETURNING id`,
    [studentId, lrn, process.env.ENCRYPTION_KEY, lrnHash(lrn)]
  );
  return result.rows.length > 0;
}

module.exports = {
  lrnHash, createStudent, findReturningStudentForGuardian, guardianOwnsStudent,
  getDocumentsOnFileForStudent, addLrnIfMissing,
};
