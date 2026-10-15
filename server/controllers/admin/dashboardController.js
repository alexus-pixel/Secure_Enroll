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

async function applications(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });

    const { status, gradeLevelId, submittedDate, page, limit } = req.query;

    // The date picker is bounded to the enrollment period on the
    // client, but this is the actual enforcement: a date outside
    // opens_at/closes_at can never match anything.
    if (submittedDate) {
      const d = new Date(submittedDate);
      if (d < new Date(activeYear.opens_at) || d > new Date(activeYear.closes_at)) {
        return res.json({ applications: [], total: 0, page: 1, limit: Number(limit) || 20 });
      }
    }

    const result = await dashboardDb.listApplications({
      schoolYearId: activeYear.id,
      status, gradeLevelId, submittedDate,
      page: Number(page) || 1, limit: Number(limit) || 20,
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load applications.' });
  }
}

module.exports = { overview, applications };
