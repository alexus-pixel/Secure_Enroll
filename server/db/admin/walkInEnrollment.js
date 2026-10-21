const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../pool');
const { gradeHasRoom, fullMessage, sectionSeats } = require('../../lib/seats');
const { checkBirthDateForGrade } = require('../../lib/ageRules');
const { findStudentByFullName, duplicateNameMessage, activeYearEnrollment, alreadyEnrolledMessage } = require('../students');

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

  // A learner already enrolled for the year enrollment is running for cannot
  // be enrolled again, so the lookup says so and the form stays closed.
  const current = await activeYearEnrollment(student.id);
  const fullName = `${student.last_name}, ${student.first_name}`;
  const completed = await lastCompletedGrade(student.id);
  return {
    ...student,
    last_enrollment: lastApp.rows[0] || null,
    // Grade levels at or below this one are finished and cannot be picked.
    last_completed_grade: completed
      ? { id: completed.id, name: completed.name, sortOrder: completed.sortOrder }
      : null,
    already_enrolled: current
      ? {
        status: current.status,
        gradeName: current.grade_name,
        sectionName: current.section_name || null,
        schoolYearLabel: current.school_year_label,
        message: alreadyEnrolledMessage(current, fullName, 'staff'),
      }
      : null,
  };
}

/**
 * The highest grade level this learner has already been enrolled and approved
 * in. A returning learner moves up from there: a grade level at or below it is
 * one they have already completed and cannot be chosen again.
 */
async function lastCompletedGrade(studentId, db = pool) {
  const { rows: [row] } = await db.query(
    `SELECT gl.id, gl.name, gl.sort_order AS "sortOrder"
       FROM enrollment_applications ea
       JOIN grade_levels gl ON gl.id = ea.grade_level_id
      WHERE ea.student_id = $1 AND ea.status = 'approved'
      ORDER BY gl.sort_order DESC LIMIT 1`,
    [studentId]
  );
  return row || null;
}

async function getGradeLevels() {
  const result = await pool.query('SELECT id, name, sort_order AS "sortOrder" FROM grade_levels ORDER BY sort_order');
  return result.rows;
}

// Sections of one grade level in the active school year.
async function getSectionsForGrade(gradeLevelId) {
  const { rows: [year] } = await pool.query('SELECT id FROM school_years WHERE is_active LIMIT 1');
  if (!year) return [];
  // Each section comes with how many slots it still has (same rule as every other page).
  const seats = await sectionSeats(pool, year.id, Number(gradeLevelId));
  return seats.map((s) => ({ id: s.id, name: s.name, capacity: s.capacity, taken: s.taken, slots_left: s.left }));
}

/**
 * The checklist the front desk ticks off, for the kind of enrollment being
 * made. A first-time learner and a returning one are asked for different
 * papers, so the desk is not shown boxes that do not apply (the audience is
 * set per document in System Settings).
 */
async function getRequiredDocumentTypes(kind = null) {
  const result = await pool.query(
    `SELECT code, label, is_required, applies_to FROM required_document_types
      WHERE is_required AND ($1::text IS NULL OR applies_to = 'all' OR applies_to = $1)
      ORDER BY sort_order`,
    [kind]
  );
  return result.rows;
}

/**
 * Tells the front desk what is already on file for a Gmail address, so the
 * form can say "this parent already has an account" before anything is typed.
 *
 * The staff member is NOT allowed to retype an existing parent's details: the
 * saved profile is what the parent signs in against and what appears on their
 * dashboard, so the form shows it read-only and this is where it comes from.
 * Only staff who may create an enrollment can call this (see the routes).
 */
async function findGuardianByEmail(email) {
  const key = process.env.ENCRYPTION_KEY;
  const address = String(email || '').trim().toLowerCase();
  if (!address) return { exists: false };

  const { rows } = await pool.query(
    `SELECT u.id, u.is_active, r.name AS role_name,
            g.first_name, g.middle_name, g.last_name, g.valid_id_type,
            pgp_sym_decrypt(g.contact_number, $2)::text AS contact_number,
            pgp_sym_decrypt(g.address, $2)::text AS address
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN guardians g ON g.user_id = u.id
     WHERE u.email = $1`,
    [address, key]
  );
  const row = rows[0];
  if (!row) return { exists: false };

  if (row.role_name !== 'parent') {
    return {
      exists: true, usable: false, accountType: 'staff', hasProfile: false,
      reason: 'That email already belongs to a staff account and cannot be used for a parent. Ask the parent for their own Gmail address.',
    };
  }
  if (!row.is_active) {
    return {
      exists: true, usable: false, accountType: 'parent', hasProfile: Boolean(row.first_name),
      reason: 'The parent account for that email is disabled. Re-enable it in User Management before enrolling.',
    };
  }

  // How many children this account already has on file. Shown at the desk as
  // a sanity check that this really is the same parent.
  const { rows: [counts] } = await pool.query(
    'SELECT COUNT(*)::int AS children FROM student_guardians WHERE guardian_id = $1',
    [row.id]
  );

  return {
    exists: true,
    usable: true,
    accountType: 'parent',
    hasProfile: Boolean(row.first_name),
    children: counts ? counts.children : 0,
    guardian: row.first_name ? {
      firstName: row.first_name,
      middleName: row.middle_name || '',
      lastName: row.last_name,
      contactNumber: row.contact_number || '',
      address: row.address || '',
      validIdType: row.valid_id_type || '',
    } : null,
  };
}

/**
 * Looks for a learner already on file under the same name, in any grade level.
 * Used twice: live on the walk-in form while the name is typed, and again
 * inside the transaction below, because the form can be bypassed. The rule
 * itself lives in db/students.js, so the parent form and the front desk
 * cannot drift apart.
 */
async function findDuplicateStudent({ firstName, middleName, lastName }, db = pool) {
  const match = await findStudentByFullName({ firstName, middleName, lastName }, db);
  if (!match) return null;
  return {
    ...match,
    last_enrollment: match.grade_level_name ? {
      grade_level_name: match.grade_level_name,
      section_name: match.section_name,
      school_year_label: match.school_year_label,
      status: match.status,
    } : null,
  };
}

/** True when this LRN already belongs to a learner on file. */
async function lrnAlreadyUsed(lrn, db = pool) {
  if (!lrn) return null;
  const { rows } = await db.query(
    'SELECT id, first_name, last_name FROM students WHERE lrn_hash = $1 LIMIT 1',
    [hashLrn(lrn)]
  );
  return rows[0] || null;
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
  email = email.trim().toLowerCase();
  const existingUser = await db.query(
    `SELECT u.id, u.is_active, r.name AS role_name
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.email = $1`,
    [email]
  );

  let userId;
  let isNew = false;

  if (existingUser.rows.length > 0) {
    const existing = existingUser.rows[0];
    // Reusing an account is only safe if it really is a parent's.
    // Without this, typing a staff email would quietly attach a
    // child's enrollment to an admin or registrar login.
    if (existing.role_name !== 'parent') {
      const err = new Error('That email already belongs to a staff account and cannot be used for a parent. Ask the parent for their own Gmail.');
      err.status = 409;
      throw err;
    }
    if (!existing.is_active) {
      const err = new Error('The parent account for that email is disabled. Re-enable it in User Management first.');
      err.status = 409;
      throw err;
    }
    userId = existing.id;
  } else {
    isNew = true;
    // No temporary password is created, read aloud or written on a slip of
    // paper. The account is given a random one nobody has ever seen, and is
    // marked as needing a password: the parent chooses their own from the
    // link emailed to them, which is also what proves the address is theirs.
    const placeholder = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(placeholder, 12);
    const role = await db.query("SELECT id FROM roles WHERE name = 'parent'");
    const newUser = await db.query(
      `INSERT INTO users (email, password_hash, role_id, full_name, is_active, must_change_password)
       VALUES ($1, $2, $3, $4, TRUE, TRUE) RETURNING id`,
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

  return { userId, isNew, email };
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
  guardianContactNumber, guardianAddress, guardianValidIdType, relationship, relationshipOther,
  gradeLevelId, sectionId, gradeQualificationMet, schoolYearId, physicalDocTypes, physicalDocsConfirmed,
  submittedBy,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const key = process.env.ENCRYPTION_KEY;

    // Check the document codes before creating anything, so a bad
    // code can't leave a half-built account behind and so only real
    // document types are ever recorded.
    // Every document type the school has, not only the required ones: a parent
    // may hand over an optional one too, and it should be recorded as received
    // rather than refused as unknown.
    const docTypes = (await client.query(
      'SELECT code, label, is_required, applies_to FROM required_document_types ORDER BY sort_order'
    )).rows;
    // What this learner is actually asked for: a first-time learner has no
    // report card to bring, a returning one has already filed a birth
    // certificate. Set per document in System Settings.
    const enrollmentKind = isNewStudent ? 'new' : 'returning';
    const appliesHere = (d) => d.applies_to === 'all' || d.applies_to === enrollmentKind;
    const validCodes = new Set(docTypes.map((d) => d.code));
    const unknownCode = physicalDocTypes.find((c) => !validCodes.has(c));
    if (unknownCode) {
      const err = new Error(`${unknownCode} is not one of the documents the school requires.`);
      err.status = 400;
      throw err;
    }

    // A walk-in is finished at the counter, so nothing is left outstanding:
    // every required document has to be in the staff member's hands now. The
    // form disables the button, and this is the rule behind it.
    const missing = docTypes.filter((d) => d.is_required && appliesHere(d) && !physicalDocTypes.includes(d.code));
    if (missing.length) {
      throw Object.assign(
        new Error(`${missing.map((d) => d.label).join(', ')} ${missing.length === 1 ? 'is' : 'are'} still missing. Every required document has to be verified before the learner can be enrolled.`),
        { status: 400, reason: 'documents_required', missingDocuments: missing.map((d) => ({ code: d.code, label: d.label })) }
      );
    }

    // The desk also has to say, in so many words, that the paper copies are in
    // hand and were checked against the originals. Ticking each document is the
    // detail; this is the confirmation that the person at the desk stands behind it.
    const applicable = docTypes.filter((d) => d.is_required && appliesHere(d));
    if (applicable.length && physicalDocsConfirmed !== true) {
      throw Object.assign(
        new Error('Confirm that you received the physical copies of the documents and checked them against the originals.'),
        { status: 400, reason: 'physical_docs_unconfirmed' }
      );
    }

    // The grade, section and (for a returning student) the student must
    // really exist -- otherwise the insert would fail halfway with a
    // confusing database error.
    const fail = (status, message) => Object.assign(new Error(message), { status });
    const { rows: [grade] } = await client.query(
      'SELECT id, name, sort_order FROM grade_levels WHERE id = $1', [gradeLevelId]
    );
    // Age for the grade is counted on the day classes start, which is the age
    // the learner will actually be sitting in that class.
    const { rows: [yearRow] } = await client.query(
      `SELECT COALESCE(classes_start_on, (opens_at AT TIME ZONE 'Asia/Manila')::date)::text AS starts_on
         FROM school_years WHERE id = $1`,
      [schoolYearId]
    );
    if (!grade) throw fail(400, 'Unrecognized grade level.');

    // Everything above the entry grade has a grade level behind it. The desk
    // confirms the learner finished it before enrolling them into the next.
    if (grade.sort_order > 0 && gradeQualificationMet !== true) {
      throw Object.assign(
        new Error(`Confirm the learner completed the grade level before ${grade.name} (Form 137 or Form 138) before enrolling them.`),
        { status: 400, reason: 'qualification_required' }
      );
    }

    // The section is chosen now, so it has to be a real section of this grade
    // in this school year, and it has to have a seat left.
    const { rows: [section] } = await client.query(
      `SELECT s.id, s.name, s.capacity,
              (SELECT COUNT(*) FROM enrollment_applications ea
                WHERE ea.section_id = s.id AND ea.status = 'approved')::int AS taken
         FROM sections s
        WHERE s.id = $1 AND s.grade_level_id = $2 AND s.school_year_id = $3`,
      [sectionId, gradeLevelId, schoolYearId]
    );
    if (!section) throw fail(400, 'That section does not belong to the chosen grade level for this school year.');
    if (section.taken >= section.capacity) {
      throw Object.assign(
        new Error(`${section.name} is full (${section.taken} of ${section.capacity}). Choose another section.`),
        { status: 409, reason: 'section_full' }
      );
    }
    // The section above has room, but the grade as a whole may not: other
    // sections and the applications waiting online count against it too.
    if (!(await gradeHasRoom(client, schoolYearId, gradeLevelId))) {
      throw fail(409, fullMessage((await client.query('SELECT name FROM grade_levels WHERE id = $1', [gradeLevelId])).rows[0].name));
    }
    if (!isNewStudent) {
      const { rows: [student] } = await client.query(
        'SELECT id, first_name, last_name FROM students WHERE id = $1', [existingStudentId]);
      if (!student) throw fail(404, 'That student was not found.');
      // A returning learner moves up. A grade level they have already been
      // approved in has been completed, so it cannot be chosen again.
      const completed = await lastCompletedGrade(student.id, client);
      if (completed && grade.sort_order <= completed.sortOrder) {
        throw Object.assign(
          new Error(`${student.first_name} ${student.last_name} has already completed ${completed.name}. Choose a grade level above it.`),
          { status: 400, reason: 'grade_completed' }
        );
      }
      // A transferee or returnee whose LRN is already enrolled for this school
      // year is already in: enrolling them twice would take a second seat and
      // put the same learner in two sections.
      const current = await activeYearEnrollment(student.id, client);
      if (current) {
        throw Object.assign(
          new Error(alreadyEnrolledMessage(current, `${student.last_name}, ${student.first_name}`, 'staff')),
          { status: 409, reason: 'already_enrolled' }
        );
      }
    }

    if (isNewStudent) {
      // Anyone entering above the first grade has been enrolled somewhere
      // before, so DepEd has already issued them an LRN. The parent's own form
      // applies the same rule; the desk cannot skip it.
      if (grade.sort_order > 0 && !lrn) {
        throw Object.assign(
          new Error(`A learner entering ${grade.name} already has an LRN from their previous school. Enter it, or use Old / Returning Student to find them.`),
          { status: 400, reason: 'lrn_required' }
        );
      }

      // A real birth date, not in the future, and old enough for this grade.
      // There is no upper limit: an adult finishing elementary school is fine.
      const dateProblem = checkBirthDateForGrade(
        birthDate,
        { sortOrder: grade.sort_order, name: grade.name },
        yearRow?.starts_on || null
      );
      if (dateProblem) throw Object.assign(new Error(dateProblem), { status: 400, reason: 'birth_date_invalid' });

      // No two learners may share a name, whatever grade level they are in.
      // The form warns while the name is being typed; this is the check that
      // actually holds, because the form can be skipped and two clerks can be
      // typing at the same moment.
      const duplicate = await findStudentByFullName({ firstName, middleName, lastName }, client);
      if (duplicate) {
        throw Object.assign(
          new Error(duplicateNameMessage(duplicate)),
          { status: 409, reason: 'duplicate_name', studentId: duplicate.id }
        );
      }
      if (lrn) {
        const owner = await lrnAlreadyUsed(lrn, client);
        if (owner) {
          throw Object.assign(
            new Error(`That LRN is already on file for ${owner.first_name} ${owner.last_name}. Check the LRN on the learner's Form 137.`),
            { status: 409, reason: 'duplicate_lrn' }
          );
        }
      }
    }

    const {
      userId: guardianUserId, isNew: accountCreated, email: accountEmail,
    } = await findOrCreateGuardianAccount(client, {
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
      // "Other" is recorded as the word the desk typed, which is what the
      // master list has to show — "Other" on its own says nothing.
      [studentId, guardianUserId,
        (relationship === 'Other' ? String(relationshipOther || '').trim() : relationship) || 'Guardian']
    );

    // A walk-in is a completed enrollment, not a request to be reviewed later:
    // the staff member has the papers in hand, has confirmed the grade
    // qualification and has chosen the section, so the learner is placed now.
    const appResult = await client.query(
      `INSERT INTO enrollment_applications
         (student_id, school_year_id, grade_level_id, section_id, status,
          grade_qualification, submitted_by, reviewed_by, reviewed_at)
       VALUES ($1, $2, $3, $4, 'approved', $5, $6, $6, NOW()) RETURNING id`,
      [studentId, schoolYearId, gradeLevelId, sectionId,
        grade.sort_order > 0 ? 'met' : null, submittedBy]
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
    return {
      studentId, applicationId, guardianUserId,
      accountEmail, accountCreated,
      // Nothing is outstanding: a walk-in is refused above unless every
      // required document has been verified at the counter.
      stillNeeded: [],
      sectionId, sectionName: section.name, gradeLevelName: grade.name,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  hashLrn, findStudentByLrn, lastCompletedGrade, getGradeLevels, getSectionsForGrade, getRequiredDocumentTypes,
  findOrCreateGuardianAccount, createWalkInEnrollment,
  findGuardianByEmail, findDuplicateStudent, lrnAlreadyUsed,
};