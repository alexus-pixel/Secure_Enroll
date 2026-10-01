const pool = require('../db/pool');
const { createStudent, guardianOwnsStudent } = require('../db/students');
const { upsertGuardian } = require('../db/guardians');
const {
  linkStudentGuardian, createApplication, getMyApplications, getApplicationForGuardian, getActiveSchoolYear,
} = require('../db/applications');
const { getDocumentsForApplication } = require('../db/documents');

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

    if (!firstName || !lastName || !birthDate || !sex || !gradeLevelId) {
      return res.status(400).json({ message: 'Missing required fields.' });
    }
    // Same rule as the client: only Kinder (grade_level_id 1 in this
    // system's seed data) may omit an LRN. Checked again here because the
    // client-side check is just UX -- anyone calling this endpoint
    // directly could skip it otherwise.
    const isKinder = String(gradeLevelId) === '1';
    if (!isKinder && !lrn) {
      return res.status(400).json({ message: 'LRN is required for Grade 1 and above.' });
    }
    if (lrn && !/^\d{12}$/.test(lrn)) {
      return res.status(400).json({ message: 'LRN should be exactly 12 digits.' });
    }

    // The school year is never taken from the client -- a parent submitting
    // an application shouldn't be able to pick an arbitrary (or past/future)
    // school_year_id just by what their browser happens to send.
    const schoolYear = await getActiveSchoolYear();
    if (!schoolYear) {
      return res.status(503).json({ message: 'Enrollment is not currently open for any school year.' });
    }

    await client.query('BEGIN');
    const studentId = await createStudent(client, { firstName, middleName, lastName, birthDate, sex, lrn });
    await upsertGuardian(client, {
      userId: req.user.id, firstName: guardianFirstName, middleName: guardianMiddleName,
      lastName: guardianLastName, contactNumber, address, validIdType,
    });
    await linkStudentGuardian(client, { studentId, guardianId: req.user.id, relationship });
    const application = await createApplication(client, {
      studentId, schoolYearId: schoolYear.id, gradeLevelId, submittedBy: req.user.id,
    });
    await client.query('COMMIT');

    await logAudit(req.user.id, 'APPLICATION_SUBMITTED', 'enrollment_application', application.id, req);
    res.status(201).json(application);
  } catch (err) {
    await client.query('ROLLBACK');
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
    const { studentId, gradeLevelId } = req.body;
    if (!studentId || !gradeLevelId) {
      return res.status(400).json({ message: 'Missing required fields.' });
    }

    const owns = await guardianOwnsStudent(req.user.id, studentId);
    if (!owns) {
      return res.status(403).json({ message: 'That student is not linked to your account.' });
    }

    const schoolYear = await getActiveSchoolYear();
    if (!schoolYear) {
      return res.status(503).json({ message: 'Enrollment is not currently open for any school year.' });
    }

    const application = await createApplication(pool, {
      studentId, schoolYearId: schoolYear.id, gradeLevelId, submittedBy: req.user.id,
    });

    await logAudit(req.user.id, 'APPLICATION_SUBMITTED', 'enrollment_application', application.id, req);
    res.status(201).json(application);
  } catch (err) {
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
    res.json({ ...application, documents });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load application.' });
  }
}

module.exports = { submit, promote, mine, detail };