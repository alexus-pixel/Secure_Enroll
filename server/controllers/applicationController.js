const pool = require('../db/pool');
const { createStudent, guardianOwnsStudent } = require('../db/students');
const { upsertGuardian } = require('../db/guardians');
const {
  linkStudentGuardian, createApplication, getMyApplications, getApplicationForGuardian, getActiveSchoolYear,
} = require('../db/applications');
const { getDocumentsForApplication } = require('../db/documents');
const { getRequiredDocumentTypes } = require('../lib/documentTypes');
const {
  isValidName, isValidContactNumber, isValidLrn, isValidSex, isValidRelationship, isValidText,
  birthDateIssue, toId, ADDRESS_MAX, CONTACT_MESSAGE,
} = require('../utils/validators');
const { sendDbError } = require('../utils/dbErrors');
const { getActiveSchoolYear: getFullActiveYear } = require('../db/admin/settings');
const { computeEnrollment, closedMessage } = require('../utils/enrollmentStatus');
const { gradeHasRoom, fullMessage } = require('../lib/seats');

// Returns the first problem with a new-application request, or '' when it is fine.
function applicationProblem(b) {
  if (b === null || typeof b !== 'object' || Array.isArray(b)) return 'The request is not valid.';
  if (!isValidName(b.firstName)) return "Enter the student's first name (letters only, up to 60 characters).";
  if (!isValidName(b.middleName, { required: false })) return "The student's middle name should contain letters only (up to 60 characters).";
  if (!isValidName(b.lastName)) return "Enter the student's last name (letters only, up to 60 characters).";
  const dateProblem = birthDateIssue(b.birthDate);
  if (dateProblem) return dateProblem;
  if (!isValidSex(b.sex)) return 'Choose the student\u2019s sex (Male or Female).';
  if (b.lrn !== undefined && b.lrn !== null && b.lrn !== '' && !isValidLrn(b.lrn)) return 'LRN should be exactly 12 digits.';
  if (toId(b.gradeLevelId) === null) return 'Unrecognized grade level.';
  if (!isValidName(b.guardianFirstName)) return "Enter the guardian's first name (letters only, up to 60 characters).";
  if (!isValidName(b.guardianMiddleName, { required: false })) return "The guardian's middle name should contain letters only (up to 60 characters).";
  if (!isValidName(b.guardianLastName)) return "Enter the guardian's last name (letters only, up to 60 characters).";
  if (!isValidRelationship(b.relationship)) return 'Choose the guardian\u2019s relationship to the student.';
  if (!isValidContactNumber(b.contactNumber)) return CONTACT_MESSAGE;
  if (!isValidText(b.address, { max: ADDRESS_MAX })) return `Enter the home address (up to ${ADDRESS_MAX} characters, no < or > symbols).`;
  if (!isValidText(b.validIdType, { required: false, max: 40 })) return 'The valid ID type is not valid.';
  return '';
}

async function logAudit(userId, action, entityType, entityId, req) {
  await pool.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, action, entityType, entityId, req.ip, req.get('user-agent')]
  );
}

async function submit(req, res) {
  const client = await pool.connect();
  try {
    const {
      firstName, middleName, lastName, birthDate, sex, lrn,
      guardianFirstName, guardianMiddleName, guardianLastName,
      relationship, contactNumber, address, validIdType,
      gradeLevelId,
    } = req.body;

    // Server-side checks: the browser form checks these too, but anyone can
    // call the API directly, so the rules are enforced again here.
    const problem = applicationProblem(req.body);
    if (problem) return res.status(400).json({ message: problem });

    const gradeId = toId(gradeLevelId);
    const lrnValue = lrn ? lrn.trim() : '';

    // Kinder (sort_order 0) is the one level where a genuinely new learner
    // has no LRN yet -- DepEd issues it immediately on first entry there.
    // Anyone entering at Grade 1-6 should already have one from wherever
    // they started, so it's required rather than optional at that point.
    // Keyed off sort_order from the DB, not a hardcoded grade id, since
    // ids can drift from whatever a fresh seed happens to assign.
    const gradeResult = await pool.query('SELECT sort_order, name FROM grade_levels WHERE id = $1', [gradeId]);
    const gradeRow = gradeResult.rows[0];
    if (!gradeRow) {
      return res.status(400).json({ message: 'Unrecognized grade level.' });
    }
    if (gradeRow.sort_order > 0 && !lrnValue) {
      return res.status(400).json({ message: 'LRN is required when enrolling into Grade 1 through Grade 6.' });
    }

    // The school year is never taken from the client -- a parent submitting
    // an application shouldn't be able to pick an arbitrary (or past/future)
    // school_year_id just by what their browser happens to send.
    const schoolYear = await getActiveSchoolYear();
    if (!schoolYear) {
      return res.status(503).json({ message: 'Enrollment is not currently open for any school year.' });
    }
    const period = computeEnrollment(await getFullActiveYear());
    if (period.state !== 'open') {
      return res.status(403).json({ message: closedMessage(period), enrollmentState: period.state });
    }

    // The same parent should not send the same child twice in one school year
    // (a double click, or a second try after a slow connection).
    const duplicate = await pool.query(
      `SELECT 1 FROM enrollment_applications ea
       JOIN students s ON s.id = ea.student_id
       JOIN student_guardians sg ON sg.student_id = s.id
       WHERE sg.guardian_id = $1 AND ea.school_year_id = $2
         AND lower(s.first_name) = lower($3) AND lower(s.last_name) = lower($4)
         AND ea.status <> 'rejected'
       LIMIT 1`,
      [req.user.id, schoolYear.id, firstName.trim(), lastName.trim()]
    );
    if (duplicate.rows.length) {
      return res.status(409).json({ message: `You already have an application for ${firstName.trim()} ${lastName.trim()} this school year.` });
    }

    await client.query('BEGIN');
    const studentId = await createStudent(client, {
      firstName: firstName.trim(), middleName: middleName ? middleName.trim() : undefined, lastName: lastName.trim(),
      birthDate: birthDate.trim(), sex, lrn: lrnValue || undefined,
    });
    await upsertGuardian(client, {
      userId: req.user.id, firstName: guardianFirstName.trim(),
      middleName: guardianMiddleName ? guardianMiddleName.trim() : undefined,
      lastName: guardianLastName.trim(), contactNumber: contactNumber.trim(),
      address: address.trim(), validIdType: validIdType ? validIdType.trim() : undefined,
    });
    await linkStudentGuardian(client, { studentId, guardianId: req.user.id, relationship });
    const application = await createApplication(client, {
      studentId, schoolYearId: schoolYear.id, gradeLevelId: gradeId, submittedBy: req.user.id,
    });
    // A seat in the grade is held from now on (the section itself is chosen by the
    // registrar after approval). When every slot of this grade is taken, nothing is saved.
    if (!(await gradeHasRoom(client, schoolYear.id, gradeId, application.id))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: fullMessage(gradeRow.name), reason: 'no_slots' });
    }
    await client.query('COMMIT');

    await logAudit(req.user.id, 'APPLICATION_SUBMITTED', 'enrollment_application', application.id, req);
    res.status(201).json(application);
  } catch (err) {
    await client.query('ROLLBACK');
    if (sendDbError(err, res)) return;
    if (err.code === '23505') {
      if (err.constraint === 'students_lrn_hash_key') {
        return res.status(409).json({ message: 'That LRN is already on file for another student.' });
      }
      return res.status(409).json({ message: 'This student is already enrolled for that school year.' });
    }
    console.error(err);
    res.status(500).json({ message: 'Could not submit application.' });
  } finally {
    client.release();
  }
}

// A returning student: no new student/guardian record, just a fresh
// enrollment_applications row against the existing linked student, for
// whatever grade the "Find Returning Student" screen determined they're
// being promoted into.
async function promote(req, res) {
  try {
    const studentId = toId(req.body && req.body.studentId);
    const gradeId = toId(req.body && req.body.gradeLevelId);
    if (!studentId || !gradeId) {
      return res.status(400).json({ message: 'Missing or invalid student or grade level.' });
    }

    const owns = await guardianOwnsStudent(req.user.id, studentId);
    if (!owns) {
      return res.status(403).json({ message: 'That student is not linked to your account.' });
    }

    // A returning student can only move up to the NEXT grade level, never skip
    // grades or go back, whatever the browser sends.
    const { rows: [next] } = await pool.query(
      `SELECT next_gl.id AS next_id
       FROM enrollment_applications ea
       JOIN grade_levels cur ON cur.id = ea.grade_level_id
       LEFT JOIN grade_levels next_gl ON next_gl.sort_order = cur.sort_order + 1
       WHERE ea.student_id = $1
       ORDER BY ea.submitted_at DESC LIMIT 1`,
      [studentId]
    );
    if (!next || !next.next_id) {
      return res.status(400).json({ message: 'This student has no higher grade level to enroll into.' });
    }
    if (Number(next.next_id) !== gradeId) {
      return res.status(400).json({ message: 'That is not the next grade level for this student.' });
    }

    const schoolYear = await getActiveSchoolYear();
    if (!schoolYear) {
      return res.status(503).json({ message: 'Enrollment is not currently open for any school year.' });
    }
    const period = computeEnrollment(await getFullActiveYear());
    if (period.state !== 'open') {
      return res.status(403).json({ message: closedMessage(period), enrollmentState: period.state });
    }

    const client = await pool.connect();
    let application;
    try {
      await client.query('BEGIN');
      application = await createApplication(client, {
        studentId, schoolYearId: schoolYear.id, gradeLevelId: gradeId, submittedBy: req.user.id,
      });
      if (!(await gradeHasRoom(client, schoolYear.id, gradeId, application.id))) {
        await client.query('ROLLBACK');
        const { rows: [g] } = await pool.query('SELECT name FROM grade_levels WHERE id = $1', [gradeId]);
        return res.status(409).json({ message: fullMessage(g.name), reason: 'no_slots' });
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    await logAudit(req.user.id, 'APPLICATION_SUBMITTED', 'enrollment_application', application.id, req);
    res.status(201).json(application);
  } catch (err) {
    if (sendDbError(err, res)) return;
    if (err.code === '23505') {
      return res.status(409).json({ message: 'This student is already enrolled for that school year.' });
    }
    console.error(err);
    res.status(500).json({ message: 'Could not submit application.' });
  }
}

async function mine(req, res) {
  try {
    res.json(await getMyApplications(req.user.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load applications.' });
  }
}

async function detail(req, res) {
  try {
    const application = await getApplicationForGuardian(req.params.id, req.user.id);
    if (!application) return res.status(404).json({ message: 'Application not found.' });
    const documents = await getDocumentsForApplication(req.params.id);
    // Only the documents the administrator checked in Settings are requested.
    const documentTypes = (await getRequiredDocumentTypes()).map((t) => ({ code: t.code, label: t.label, required: true }));
    res.json({ ...application, documents, documentTypes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load application.' });
  }
}

module.exports = { submit, promote, mine, detail };