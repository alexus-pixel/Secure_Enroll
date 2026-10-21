const pool = require('../db/pool');
const {
  createStudent, guardianOwnsStudent, findStudentByFullName, duplicateNameMessage, findStudentByLrn,
  activeYearEnrollment, alreadyEnrolledMessage,
} = require('../db/students');
const { upsertGuardian } = require('../db/guardians');
const {
  linkStudentGuardian, createApplication, getMyApplications, getApplicationForGuardian, getActiveSchoolYear,
} = require('../db/applications');
const { getDocumentsForApplication } = require('../db/documents');
const { getRequiredDocumentTypes } = require('../lib/documentTypes');
const {
  isValidName, isValidContactNumber, isValidLrn, isValidSex, isValidRelationship, isValidText,
  birthDateIssue, toId, addressIssue, NAME_MIN, NAME_MAX, CONTACT_MESSAGE,
} = require('../utils/validators');
const { sendDbError } = require('../utils/dbErrors');
const { getActiveSchoolYear: getFullActiveYear } = require('../db/admin/settings');
const { computeEnrollment, closedMessage } = require('../utils/enrollmentStatus');
const { gradeHasRoom, fullMessage } = require('../lib/seats');
const { checkBirthDateForGrade } = require('../lib/ageRules');

/**
 * Every document the school marked as required has to be in hand before an
 * application is accepted — the parent cannot enroll now and bring the papers
 * later. The browser blocks the button; this is the rule behind it.
 *
 * `declared` is the list of document codes the browser is about to upload.
 * The files themselves arrive on the next request, so this checks the list,
 * and each file is then checked for real (type, size, signature) as it lands.
 */
async function missingRequiredDocuments(declared, kind) {
  const required = await getRequiredDocumentTypes(undefined, kind);
  const provided = new Set(Array.isArray(declared) ? declared.map(String) : []);
  return required.filter((d) => !provided.has(d.code)).map((d) => ({ code: d.code, label: d.label }));
}

// How a name field is described when it is wrong, so every message reads the same.
const NAME_RULE = `letters only, ${NAME_MIN} to ${NAME_MAX} characters`;

/**
 * A middle name may be left out, but only deliberately: the form sends
 * `noMiddleName` (or `guardianNoMiddleName`) when the person has ticked the
 * "No middle name" box. A blank box with no tick is a skipped field.
 */
function middleNameProblem(value, none, label) {
  const given = typeof value === 'string' ? value.trim() : '';
  if (none === true) {
    return given ? `Untick "No middle name" to enter the ${label}.` : '';
  }
  if (!given) return `Enter the ${label}, or tick "No middle name".`;
  return isValidName(given) ? '' : `The ${label} should contain ${NAME_RULE}.`;
}

// Returns the first problem with a new-application request, or '' when it is fine.
function applicationProblem(b) {
  if (b === null || typeof b !== 'object' || Array.isArray(b)) return 'The request is not valid.';
  if (!isValidName(b.firstName)) return `Enter the student's first name (${NAME_RULE}).`;
  const studentMiddle = middleNameProblem(b.middleName, b.noMiddleName, "student's middle name");
  if (studentMiddle) return studentMiddle;
  if (!isValidName(b.lastName)) return `Enter the student's last name (${NAME_RULE}).`;
  const dateProblem = birthDateIssue(b.birthDate);
  if (dateProblem) return dateProblem;
  if (!isValidSex(b.sex)) return 'Choose the student\u2019s sex (Male or Female).';
  if (b.lrn !== undefined && b.lrn !== null && b.lrn !== '' && !isValidLrn(b.lrn)) return 'LRN should be exactly 12 digits.';
  if (toId(b.gradeLevelId) === null) return 'Unrecognized grade level.';
  if (!isValidName(b.guardianFirstName)) return `Enter the guardian's first name (${NAME_RULE}).`;
  const guardianMiddle = middleNameProblem(b.guardianMiddleName, b.guardianNoMiddleName, "guardian's middle name");
  if (guardianMiddle) return guardianMiddle;
  if (!isValidName(b.guardianLastName)) return `Enter the guardian's last name (${NAME_RULE}).`;
  if (!isValidRelationship(b.relationship)) return 'Choose the guardian\u2019s relationship to the student.';
  if (b.relationship === 'Other' && !isValidName(b.relationshipOther, { label: 'Relationship' })) {
    return 'Say how this person is related to the learner (letters only).';
  }
  if (!isValidContactNumber(b.contactNumber)) return CONTACT_MESSAGE;
  const addressProblem = addressIssue(b.address);
  if (addressProblem) return addressProblem;
  if (!isValidText(b.validIdType, { required: false, max: 40 })) return 'The valid ID type is not valid.';
  return '';
}

/**
 * What goes in the record: one of the five named relationships, or the word
 * the person typed when they chose "Other".
 */
function storedRelationship(b) {
  return b.relationship === 'Other' ? String(b.relationshipOther || '').trim() : b.relationship;
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
    // A request that sent no body at all, or something that is not JSON,
    // reaches here as undefined. That is a bad request, not a crash.
    } = req.body || {};

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

    // A real birth date, not in the future, and old enough for the grade being
    // applied for (lib/ageRules.js). There is no upper limit: an adult
    // finishing elementary school is welcome.
    const dateProblem = checkBirthDateForGrade(
      birthDate.trim(),
      { sortOrder: gradeRow.sort_order, name: gradeRow.name },
      // Age is counted on the first day of classes, which is the day the
      // learner actually sits in the room, not the day enrollment opened.
      schoolYear.classes_start_on
        ? String(schoolYear.classes_start_on).slice(0, 10)
        : period.opensOn || null
    );
    if (dateProblem) return res.status(400).json({ message: dateProblem, reason: 'birth_date_invalid' });

    // An LRN belongs to one learner in DepEd's register, so it belongs to one
    // record here. Checked before anything is written, so the parent gets a
    // sentence rather than a failed insert.
    if (lrnValue) {
      // This form makes a NEW learner, so an LRN already in the register
      // belongs to somebody else — a mistyped digit far more often than a
      // learner being entered twice. "Already enrolled" is the answer on the
      // returning-learner path below, where the learner is this parent's own.
      const lrnOwner = await findStudentByLrn(lrnValue);
      if (lrnOwner) {
        return res.status(409).json({
          message: `That LRN is already on file for ${lrnOwner.last_name}, ${lrnOwner.first_name}. Check the LRN on your child's Form 137.`,
          reason: 'duplicate_lrn',
        });
      }
    }

    // No two learners may share a name, whatever grade level they are in.
    const sameName = await findStudentByFullName({ firstName, middleName, lastName });
    if (sameName) {
      return res.status(409).json({
        message: duplicateNameMessage(sameName),
        reason: 'duplicate_name',
        studentId: sameName.id,
      });
    }

    // Nothing is enrolled with requirements missing.
    // A learner being enrolled for the first time: the new-learner checklist.
    const missingDocs = await missingRequiredDocuments(req.body.providedDocuments, 'new');
    if (missingDocs.length) {
      return res.status(400).json({
        message: `Please attach ${missingDocs.map((d) => d.label).join(', ')} before submitting. Every required document has to be in hand to enroll.`,
        reason: 'documents_required',
        missingDocuments: missingDocs,
      });
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
      address: address.trim().replace(/\s+/g, ' '),
      validIdType: validIdType ? validIdType.trim() : undefined,
    });
    await linkStudentGuardian(client, {
      studentId, guardianId: req.user.id, relationship: storedRelationship(req.body),
    });
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
    await client.query('ROLLBACK').catch(() => {});
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

    // Already enrolled for this school year: a second application would hold a
    // second seat for the same child.
    const current = await activeYearEnrollment(studentId);
    if (current) {
      return res.status(409).json({
        message: alreadyEnrolledMessage(current),
        reason: 'already_enrolled',
      });
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

    // Same rule as a first-time application: no enrolling with papers missing.
    // A learner moving up a grade: the returning-learner checklist.
    const missingDocs = await missingRequiredDocuments(req.body && req.body.providedDocuments, 'returning');
    if (missingDocs.length) {
      return res.status(400).json({
        message: `Please attach ${missingDocs.map((d) => d.label).join(', ')} before submitting. Every required document has to be in hand to enroll.`,
        reason: 'documents_required',
        missingDocuments: missingDocs,
      });
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
    // Whether the registrar has asked for a corrected LRN for this learner.
    const { rows: [lrnRow] } = await pool.query(
      `SELECT s.lrn_hash IS NOT NULL AS on_file, s.lrn_flagged_at, s.lrn_flag_note
       FROM enrollment_applications ea JOIN students s ON s.id = ea.student_id
       WHERE ea.id = $1`,
      [req.params.id]
    );
    // Only the documents the administrator checked in Settings are requested.
    const documentTypes = (await getRequiredDocumentTypes()).map((t) => ({ code: t.code, label: t.label, required: true }));
    res.json({
      ...application,
      documents,
      documentTypes,
      lrn: lrnRow ? {
        onFile: lrnRow.on_file,
        flaggedAt: lrnRow.lrn_flagged_at,
        note: lrnRow.lrn_flag_note,
      } : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load application.' });
  }
}

module.exports = { submit, promote, mine, detail };