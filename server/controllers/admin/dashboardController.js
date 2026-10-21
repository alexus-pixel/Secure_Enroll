const dashboardDb = require('../../db/admin/dashboard');
const settingsDb = require('../../db/admin/settings');

async function overview(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });

    const [summary, byGrade, statusBreakdown, registrarActivity] = await Promise.all([
      dashboardDb.getSummaryCounts(activeYear.id),
      dashboardDb.getEnrollmentByGrade(activeYear.id),
      dashboardDb.getStatusBreakdown(activeYear.id),
      dashboardDb.getRegistrarActivity(),
    ]);

    res.json({ schoolYear: activeYear, summary, byGrade, statusBreakdown, registrarActivity });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load dashboard.' });
  }
}

module.exports = { overview };
