const settingsDb = require('../../db/admin/settings');
const { logAudit } = require('../../lib/audit');

async function overview(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });

    const [gradeLevels, requiredDocuments] = await Promise.all([
      settingsDb.getGradeLevelSlotSummary(activeYear.id),
      settingsDb.getRequiredDocuments(),
    ]);
    res.json({ schoolYear: activeYear, gradeLevels, requiredDocuments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load system settings.' });
  }
}

async function updateEnrollmentPeriod(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });

    const updated = await settingsDb.updateEnrollmentPeriod(activeYear.id, req.body);
    await logAudit(req.user.id, 'ENROLLMENT_PERIOD_UPDATED', 'school_year', activeYear.id, req, req.body);
    res.json(updated);
  } catch (err) {
    if (err.status && err.status < 500) {
      return res.status(err.status).json({
        message: err.message, ...(err.reason ? { reason: err.reason } : {}),
      });
    }
    console.error(err);
    res.status(500).json({ message: 'Could not update the enrollment period.' });
  }
}

async function updateRequiredDocuments(req, res) {
  try {
    const updated = await settingsDb.updateRequiredDocuments(req.body.documents);
    await logAudit(req.user.id, 'REQUIRED_DOCUMENTS_UPDATED', 'required_document_types', null, req, req.body);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not update required documents.' });
  }
}

// Errors thrown on purpose (a name already in use, a document somebody has
// already submitted) carry their own status and a sentence worth showing.
function sendProblem(err, res, fallback) {
  if (err.status && err.status < 500) {
    return res.status(err.status).json({
      message: err.message, ...(err.reason ? { reason: err.reason } : {}),
    });
  }
  console.error(err);
  return res.status(500).json({ message: fallback });
}

async function addRequiredDocument(req, res) {
  try {
    const created = await settingsDb.addRequiredDocument(req.body);
    await logAudit(req.user.id, 'REQUIRED_DOCUMENT_ADDED', 'required_document_types', created.id, req, req.body);
    res.status(201).json(await settingsDb.getRequiredDocuments());
  } catch (err) {
    sendProblem(err, res, 'Could not add that document.');
  }
}

async function updateRequiredDocument(req, res) {
  try {
    const updated = await settingsDb.updateRequiredDocument(req.params.id, req.body);
    await logAudit(req.user.id, 'REQUIRED_DOCUMENT_UPDATED', 'required_document_types', updated.id, req, req.body);
    res.json(await settingsDb.getRequiredDocuments());
  } catch (err) {
    sendProblem(err, res, 'Could not update that document.');
  }
}

async function deleteRequiredDocument(req, res) {
  try {
    const removed = await settingsDb.deleteRequiredDocument(req.params.id);
    await logAudit(req.user.id, 'REQUIRED_DOCUMENT_REMOVED', 'required_document_types', removed.id, req, { label: removed.label });
    res.json(await settingsDb.getRequiredDocuments());
  } catch (err) {
    sendProblem(err, res, 'Could not remove that document.');
  }
}

module.exports = {
  overview, updateEnrollmentPeriod, updateRequiredDocuments,
  addRequiredDocument, updateRequiredDocument, deleteRequiredDocument,
};
