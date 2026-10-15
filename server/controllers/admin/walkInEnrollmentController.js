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

async function gradeLevels(req, res) {
  try {
    res.json(await walkInDb.getGradeLevels());
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load grade levels.' });
  }
}

async function sections(req, res) {
  try {
    const gradeLevelId = Number(req.query.gradeLevelId);
    if (!Number.isInteger(gradeLevelId) || gradeLevelId <= 0) return res.json([]);
    res.json(await walkInDb.getSectionsForGrade(gradeLevelId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load sections.' });
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
      studentId: result.studentId, guardianAccountCreated: result.accountCreated,
      guardianEmail: result.accountEmail, missingRequiredDocuments: result.stillNeeded,
    });

    res.status(201).json(result);
  } catch (err) {
    // Errors thrown on purpose (wrong role, disabled account, bad
    // document code) carry their own status and a message that is
    // safe to show the admin. Everything else stays a generic 500.
    if (err.status && err.status < 500) {
      return res.status(err.status).json({ message: err.message });
    }
    // Unique violations: the database's duplicate-record defences.
    if (err.code === '23505') {
      const isLrn = /lrn/i.test(err.constraint || err.detail || '');
      return res.status(409).json({
        message: isLrn
          ? 'A student with that LRN already exists. Use "Old / Returning Student" and search by LRN instead.'
          : 'This student already has an application for the active school year.',
      });
    }
    console.error(err);
    res.status(500).json({ message: 'Could not complete this enrollment.' });
  }
}

module.exports = { requiredDocuments, gradeLevels, sections, lookupByLrn, create };