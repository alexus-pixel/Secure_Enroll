const pool = require('../db/pool');
const { createStudent } = require('../db/students');
const { upsertGuardian } = require('../db/guardians');
const { linkStudentGuardian, createApplication, getMyApplications, getApplicationForGuardian } = require('../db/applications');
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
      firstName, middleName, lastName, birthDate, sex,
      guardianFirstName, guardianMiddleName, guardianLastName,
      relationship, contactNumber, address, validIdType,
      gradeLevelId, schoolYearId,
    } = req.body;

    if (!firstName || !lastName || !birthDate || !sex || !gradeLevelId || !schoolYearId) {
      return res.status(400).json({ message: 'Missing required fields.' });
    }

    await client.query('BEGIN');
    const studentId = await createStudent(client, { firstName, middleName, lastName, birthDate, sex });
    await upsertGuardian(client, {
      userId: req.user.id, firstName: guardianFirstName, middleName: guardianMiddleName,
      lastName: guardianLastName, contactNumber, address, validIdType,
    });
    await linkStudentGuardian(client, { studentId, guardianId: req.user.id, relationship });
    const application = await createApplication(client, {
      studentId, schoolYearId, gradeLevelId, submittedBy: req.user.id,
    });
    await client.query('COMMIT');

    await logAudit(req.user.id, 'APPLICATION_SUBMITTED', 'enrollment_application', application.id, req);
    res.status(201).json(application);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ message: 'This student is already enrolled for that school year.' });
    }
    console.error(err);
    res.status(500).json({ message: 'Could not submit application.' });
  } finally {
    client.release();
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

module.exports = { submit, mine, detail };