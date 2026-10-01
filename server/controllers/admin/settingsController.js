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

module.exports = { overview, updateEnrollmentPeriod, updateRequiredDocuments };
