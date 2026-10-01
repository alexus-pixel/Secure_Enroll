const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../pool');

// The schema has carried an lrn_hash column ("blind index: SHA-256
// of the LRN") since the original schema.sql, but nothing in the
// codebase ever actually computed or queried it — the parent-facing
// "old student" lookup this was clearly meant for was never wired
// up. This is that lookup, implemented for the first time, doing
// exactly what the column's own comment describes: a deterministic
// hash lets an LRN be searched for an exact match without decrypting
// every row, the same way a password hash lets a login be checked
// without storing the password itself.
function hashLrn(lrn) {
  return crypto.createHash('sha256').update(lrn.trim()).digest('hex');
}

async function findStudentByLrn(lrn) {
  const key = process.env.ENCRYPTION_KEY;
  const result = await pool.query(
    `SELECT id, first_name, middle_name, last_name, sex,
            pgp_sym_decrypt(birth_date, $2)::date AS birth_date
     FROM students WHERE lrn_hash = $1`,
    [hashLrn(lrn), key]
  );
  const student = result.rows[0];
  if (!student) return null;

  // Most recent application tells the admin what this student was
  // last enrolled as — "currently Grade 5, Section A" — so a
  // walk-in promotion shows real context instead of a blank slate.
  const lastApp = await pool.query(
    `SELECT ea.grade_level_id, gl.name AS grade_level_name, sec.name AS section_name, sy.label AS school_year_label
     FROM enrollment_applications ea
     JOIN grade_levels gl ON gl.id = ea.grade_level_id
     JOIN school_years sy ON sy.id = ea.school_year_id
     LEFT JOIN sections sec ON sec.id = ea.section_id
     WHERE ea.student_id = $1
     ORDER BY sy.opens_at DESC LIMIT 1`,
    [student.id]
  );
  return { ...student, last_enrollment: lastApp.rows[0] || null };
}

async function getRequiredDocumentTypes() {
  const result = await pool.query(
    'SELECT code, label, is_required FROM required_document_types ORDER BY sort_order'
  );
  return result.rows;
}

/**
 * Finds a guardian by email, or creates a brand-new parent account
 * for them. A walk-in guardian didn't self-register, so there's no
 * password to reuse — one is generated here and returned in plain
 * text exactly once, for the admin to hand to the parent on the
 * spot (or the parent can reset it later); it is never logged or
 * stored anywhere but the bcrypt hash.
 */
async function findOrCreateGuardianAccount(db, {
  email, firstName, lastName, middleName, contactNumber, address, validIdType,
}) {
  const key = process.env.ENCRYPTION_KEY;
  const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email]);

  let userId;
  let tempPassword = null;

  if (existingUser.rows.length > 0) {
    userId = existingUser.rows[0].id;
  } else {
    // Readable temp password (no ambiguous characters), not a
    // full random byte string — an admin may need to read this
    // aloud or write it on a slip of paper for the parent.
    tempPassword = crypto.randomBytes(12).toString('base64')
      .replace(/[^A-Za-z0-9]/g, '').slice(0, 10);
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const role = await db.query("SELECT id FROM roles WHERE name = 'parent'");
    const newUser = await db.query(
      `INSERT INTO users (email, password_hash, role_id, full_name, is_active)
       VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
      [email, passwordHash, role.rows[0].id, `${firstName} ${lastName}`]
    );
    userId = newUser.rows[0].id;
  }

  // A guardian row is 1:1 with a parent-role user (guardians.user_id
  // is its primary key) — create it if this account doesn't have one
  // yet, whether that account is brand new or already existed
  // without ever completing a guardian profile.
  const existingGuardian = await db.query('SELECT user_id FROM guardians WHERE user_id = $1', [userId]);
  if (existingGuardian.rows.length === 0) {
    await db.query(
      `INSERT INTO guardians (user_id, first_name, middle_name, last_name, contact_number, address, valid_id_type)
       VALUES ($1, $2, $3, $4, pgp_sym_encrypt($5::text, $7), pgp_sym_encrypt($6::text, $7), $8)`,
      [userId, firstName, middleName || null, lastName, contactNumber, address, key, validIdType || null]
    );
  }

  return { userId, tempPassword };
}

/**
 * The full walk-in submission, in one transaction: find-or-create
 * the guardian's account, create the student record (new-student
 * path only — an existing student is passed in by id instead),
 * link them, create the enrollment application, and record each
 * physically-handed-over document as an already-verified document
 * row (is_physical, no file) — the admin is looking at the paper
 * right now, there's nothing left to verify later the way an
 * uploaded scan would need to be.
 */
async function createWalkInEnrollment({
  isNewStudent, existingStudentId,
  firstName, middleName, lastName, birthDate, sex, lrn,
  guardianEmail, guardianFirstName, guardianLastName, guardianMiddleName,
  guardianContactNumber, guardianAddress, guardianValidIdType, relationship,
  gradeLevelId, sectionId, schoolYearId, physicalDocTypes, submittedBy,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const key = process.env.ENCRYPTION_KEY;

    const { userId: guardianUserId, tempPassword } = await findOrCreateGuardianAccount(client, {
      email: guardianEmail, firstName: guardianFirstName, lastName: guardianLastName,
      middleName: guardianMiddleName, contactNumber: guardianContactNumber,
      address: guardianAddress, validIdType: guardianValidIdType,
    });

    let studentId = existingStudentId;
    if (isNewStudent) {
      const lrnHash = lrn ? hashLrn(lrn) : null;
      const studentResult = await client.query(
        `INSERT INTO students (first_name, middle_name, last_name, birth_date, sex, lrn_encrypted, lrn_hash)
         VALUES ($1, $2, $3, pgp_sym_encrypt($4::text, $7), $5,
                 CASE WHEN $6::text IS NULL THEN NULL ELSE pgp_sym_encrypt($6::text, $7) END, $8)
         RETURNING id`,
        [firstName, middleName || null, lastName, birthDate, sex, lrn || null, key, lrnHash]
      );
      studentId = studentResult.rows[0].id;
    }

    await client.query(
      `INSERT INTO student_guardians (student_id, guardian_id, relationship, is_primary)
       VALUES ($1, $2, $3, TRUE) ON CONFLICT (student_id, guardian_id) DO NOTHING`,
      [studentId, guardianUserId, relationship || 'Guardian']
    );

    const appResult = await client.query(
      `INSERT INTO enrollment_applications (student_id, school_year_id, grade_level_id, section_id, status, submitted_by)
       VALUES ($1, $2, $3, $4, 'submitted', $5) RETURNING id`,
      [studentId, schoolYearId, gradeLevelId, sectionId || null, submittedBy]
    );
    const applicationId = appResult.rows[0].id;

    for (const docType of physicalDocTypes) {
      await client.query(
        `INSERT INTO documents (application_id, doc_type, status, is_physical, verified_by, verified_at)
         VALUES ($1, $2, 'verified', TRUE, $3, NOW())`,
        [applicationId, docType, submittedBy]
      );
    }

    await client.query('COMMIT');
    return { studentId, applicationId, guardianUserId, tempPassword };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  hashLrn, findStudentByLrn, getRequiredDocumentTypes, findOrCreateGuardianAccount, createWalkInEnrollment,
};
