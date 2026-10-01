const walkInDb = require('../../db/admin/walkInEnrollment');
const settingsDb = require('../../db/admin/settings');
const { logAudit } = require('../../lib/audit');

async function requiredDocuments(req, res) {
  try {
    res.json(await walkInDb.getRequiredDocumentTypes());
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load required document types.' });
  }
}

async function lookupByLrn(req, res) {
  try {
    const student = await walkInDb.findStudentByLrn(req.query.lrn);
    if (!student) return res.status(404).json({ message: 'No student found with that LRN.' });
    res.json(student);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not look up that LRN.' });
  }
}

async function create(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });

    const result = await walkInDb.createWalkInEnrollment({
      ...req.body, schoolYearId: activeYear.id, submittedBy: req.user.id,
    });

    await logAudit(req.user.id, 'WALKIN_ENROLLMENT_CREATED', 'enrollment_application', result.applicationId, req, {
      studentId: result.studentId, guardianAccountCreated: !!result.tempPassword,
    });

    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not complete this enrollment.' });
  }
}

module.exports = { requiredDocuments, lookupByLrn, create };
