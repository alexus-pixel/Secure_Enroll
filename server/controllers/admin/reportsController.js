const reportsDb = require('../../db/admin/reports');
const settingsDb = require('../../db/admin/settings');
const { toCsv } = require('../../lib/csv');
const { masterEnrollmentListPdf } = require('../../lib/pdf');
const { logAudit } = require('../../lib/audit');

async function resolveActiveYear(res) {
  const year = await settingsDb.getActiveSchoolYear();
  if (!year) res.status(404).json({ message: 'No active school year is set.' });
  return year;
}

function sendCsv(res, filenamePrefix, rows, columns) {
  const csv = toCsv(rows, columns);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filenamePrefix}-${Date.now()}.csv"`);
  res.send(csv);
}

async function masterEnrollmentList(req, res) {
  try {
    const year = await resolveActiveYear(res);
    if (!year) return;
    const { from, to, format } = req.query;
    const rows = await reportsDb.masterEnrollmentList({ schoolYearId: year.id, from, to });
    await logAudit(req.user.id, 'REPORT_EXPORTED', null, null, req, { report: 'master_enrollment_list', format, rowCount: rows.length });

    if (format === 'pdf') {
      const pdf = await masterEnrollmentListPdf({ schoolYearLabel: year.label, students: rows });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="master-enrollment-list-${Date.now()}.pdf"`);
      return res.send(pdf);
    }
    sendCsv(res, 'master-enrollment-list', rows, [
      { label: 'Last Name', value: 'last_name' }, { label: 'First Name', value: 'first_name' },
      { label: 'Middle Name', value: (r) => r.middle_name || '' }, { label: 'LRN', value: 'lrn' },
      { label: 'Grade Level', value: 'grade_level' }, { label: 'Section', value: (r) => r.section || '' },
      { label: 'Guardian', value: (r) => r.guardian_name || '' }, { label: 'Guardian Contact', value: (r) => r.guardian_contact || '' },
      { label: 'Submitted', value: (r) => new Date(r.submitted_at).toISOString().slice(0, 10) },
    ]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not generate the report.' });
  }
}

async function applicationStatusReport(req, res) {
  try {
    const year = await resolveActiveYear(res);
    if (!year) return;
    const { from, to } = req.query;
    const rows = await reportsDb.applicationStatusReport({ schoolYearId: year.id, from, to });
    await logAudit(req.user.id, 'REPORT_EXPORTED', null, null, req, { report: 'application_status', rowCount: rows.length });
    sendCsv(res, 'application-status-report', rows, [
      { label: 'Grade Level', value: 'grade_level' }, { label: 'Status', value: 'status' }, { label: 'Count', value: 'count' },
    ]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not generate the report.' });
  }
}

async function pendingApplications(req, res) {
  try {
    const year = await resolveActiveYear(res);
    if (!year) return;
    const { from, to } = req.query;
    const rows = await reportsDb.pendingApplications({ schoolYearId: year.id, from, to });
    await logAudit(req.user.id, 'REPORT_EXPORTED', null, null, req, { report: 'pending_applications', rowCount: rows.length });
    sendCsv(res, 'pending-applications', rows, [
      { label: 'Last Name', value: 'last_name' }, { label: 'First Name', value: 'first_name' },
      { label: 'Grade Level', value: 'grade_level' }, { label: 'Status', value: 'status' },
      { label: 'Pending Documents', value: 'pending_documents' },
      { label: 'Submitted', value: (r) => new Date(r.submitted_at).toISOString().slice(0, 10) },
    ]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not generate the report.' });
  }
}

async function registrarActivityReport(req, res) {
  try {
    const { from, to } = req.query;
    const rows = await reportsDb.registrarActivityReport({ from, to });
    await logAudit(req.user.id, 'REPORT_EXPORTED', null, null, req, { report: 'registrar_activity', rowCount: rows.length });
    sendCsv(res, 'registrar-activity-report', rows, [
      { label: 'Registrar', value: 'registrar_email' }, { label: 'Action', value: 'action' },
      { label: 'Entity Type', value: (r) => r.entity_type || '' }, { label: 'Entity ID', value: (r) => r.entity_id || '' },
      { label: 'Timestamp', value: (r) => new Date(r.created_at).toISOString() },
    ]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not generate the report.' });
  }
}

async function duplicateFlagsReport(req, res) {
  try {
    const year = await resolveActiveYear(res);
    if (!year) return;
    const { from, to } = req.query;
    const rows = await reportsDb.duplicateFlagsReport({ schoolYearId: year.id, from, to });
    await logAudit(req.user.id, 'REPORT_EXPORTED', null, null, req, { report: 'duplicate_flags', rowCount: rows.length });
    sendCsv(res, 'duplicate-flags-report', rows, [
      { label: 'Last Name', value: 'last_name' }, { label: 'First Name', value: 'first_name' },
      { label: 'Birth Date', value: (r) => new Date(r.birth_date).toISOString().slice(0, 10) },
      { label: 'LRN', value: (r) => r.lrn || '' }, { label: 'Flag Reason', value: 'flag_reason' },
      { label: 'Status', value: 'status' },
      { label: 'Submitted', value: (r) => new Date(r.submitted_at).toISOString().slice(0, 10) },
    ]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not generate the report.' });
  }
}

async function gradeLevelCapacityReport(req, res) {
  try {
    const year = await resolveActiveYear(res);
    if (!year) return;
    const rows = await reportsDb.gradeLevelCapacityReport(year.id);
    await logAudit(req.user.id, 'REPORT_EXPORTED', null, null, req, { report: 'grade_level_capacity', rowCount: rows.length });
    sendCsv(res, 'grade-level-capacity', rows, [
      { label: 'Grade Level', value: 'grade_level' }, { label: 'Enrolled', value: 'enrolled' },
      { label: 'Total Capacity', value: 'total_capacity' },
      { label: 'Utilization %', value: (r) => r.total_capacity > 0 ? Math.round((r.enrolled / r.total_capacity) * 100) : 0 },
    ]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not generate the report.' });
  }
}

module.exports = {
  masterEnrollmentList, applicationStatusReport, pendingApplications,
  registrarActivityReport, duplicateFlagsReport, gradeLevelCapacityReport,
};
