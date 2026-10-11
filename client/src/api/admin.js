import api from './client';

// ---------- Dashboard ----------
export const getDashboardOverview = () => api.get('/admin/dashboard/overview').then((r) => r.data);
export const getDashboardApplications = (params) =>
  api.get('/admin/dashboard/applications', { params }).then((r) => r.data);

// ---------- Users ----------
export const getUsers = (params) => api.get('/admin/users', { params }).then((r) => r.data);
export const getUserCounts = () => api.get('/admin/users/counts').then((r) => r.data);
export const getRoles = () => api.get('/admin/users/roles').then((r) => r.data);
export const createUser = (data) => api.post('/admin/users', data).then((r) => r.data);
export const updateUserRole = (id, roleId) => api.patch(`/admin/users/${id}/role`, { roleId }).then((r) => r.data);
export const setUserActive = (id, isActive) => api.patch(`/admin/users/${id}/active`, { isActive }).then((r) => r.data);
export const resetUserPassword = (id, newPassword) =>
  api.post(`/admin/users/${id}/reset-password`, { newPassword }).then((r) => r.data);

// ---------- Teachers ----------
export const getTeachers = (search) => api.get('/admin/teachers', { params: { search } }).then((r) => r.data);
export const getDegreeOptions = () => api.get('/admin/teachers/degree-options').then((r) => r.data);
export const getTeacher = (id) => api.get(`/admin/teachers/${id}`).then((r) => r.data);
export const createTeacher = (data) => api.post('/admin/teachers', data).then((r) => r.data);
export const updateTeacher = (id, data) => api.patch(`/admin/teachers/${id}`, data).then((r) => r.data);
export const getTeacherSchedule = (id) => api.get(`/admin/teachers/${id}/schedule`).then((r) => r.data);
export const sendTeacherPdf = (id) => api.post(`/admin/teachers/${id}/send-pdf`).then((r) => r.data);

// ---------- Class Schedules ----------
export const getGradeScheduleSummary = (schoolYearId) =>
  api.get('/admin/schedules/grades', { params: { schoolYearId } }).then((r) => r.data);
export const getSectionsForGrade = (gradeLevelId, schoolYearId) =>
  api.get(`/admin/schedules/grades/${gradeLevelId}/sections`, { params: { schoolYearId } }).then((r) => r.data);
export const getSubjectsForGrade = (gradeLevelId, schoolYearId) =>
  api.get(`/admin/schedules/grades/${gradeLevelId}/subjects`, { params: { schoolYearId } }).then((r) => r.data);
export const getAllSubjects = () => api.get('/admin/schedules/subjects').then((r) => r.data);
export const checkTeacherEmail = (email) =>
  api.get('/admin/teachers/check-email', { params: { email } }).then((r) => r.data);
export const createSubject = (data) => api.post('/admin/schedules/subjects', data).then((r) => r.data);
export const deleteSubject = (id) => api.delete(`/admin/schedules/subjects/${id}`).then((r) => r.data);
export const getSectionSchedule = (sectionId, schoolYearId) =>
  api.get(`/admin/schedules/sections/${sectionId}/entries`, { params: { schoolYearId } }).then((r) => r.data);
export const checkScheduleConflict = (params) =>
  api.get('/admin/schedules/conflict-check', { params }).then((r) => r.data);
export const createScheduleEntry = (data) => api.post('/admin/schedules/entries', data).then((r) => r.data);
export const updateScheduleEntry = (id, data) => api.patch(`/admin/schedules/entries/${id}`, data).then((r) => r.data);
export const deleteScheduleEntry = (id) => api.delete(`/admin/schedules/entries/${id}`).then((r) => r.data);
export const getTeacherAssignments = (teacherId) =>
  api.get(`/admin/schedules/teachers/${teacherId}/assignments`).then((r) => r.data);

// ---------- Audit Log ----------
export const getAuditLogs = (params) => api.get('/admin/audit-logs', { params }).then((r) => r.data);
export const getAuditLogActions = () => api.get('/admin/audit-logs/actions').then((r) => r.data);

// A plain <a href> to this endpoint would 401: auth here is a
// Bearer token added by the axios interceptor in client.js, not a
// cookie, so a normal browser navigation never sends it. Fetching
// as a blob through axios carries the header correctly, then we
// hand the browser a local object URL to actually save.
export async function downloadAuditLogCsv(params) {
  const response = await api.get('/admin/audit-logs/export', { params, responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `audit-log-${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

// ---------- Reports & Export ----------
async function downloadReport(path, params, extension) {
  const response = await api.get(`/admin/reports/${path}`, { params, responseType: 'blob' });
  const mime = extension === 'pdf' ? 'application/pdf' : 'text/csv';
  const url = window.URL.createObjectURL(new Blob([response.data], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${path}-${Date.now()}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
export const downloadMasterEnrollmentList = (params, format) =>
  downloadReport('master-enrollment-list', { ...params, format }, format === 'pdf' ? 'pdf' : 'csv');
export const downloadApplicationStatusReport = (params) => downloadReport('application-status', params, 'csv');
export const downloadPendingApplications = (params) => downloadReport('pending-applications', params, 'csv');
export const downloadRegistrarActivityReport = (params) => downloadReport('registrar-activity', params, 'csv');
export const downloadDuplicateFlagsReport = (params) => downloadReport('duplicate-flags', params, 'csv');
export const downloadGradeLevelCapacityReport = (params) => downloadReport('grade-level-capacity', params, 'csv');

// ---------- System Settings ----------
export const getSystemSettings = () => api.get('/admin/settings').then((r) => r.data);
export const updateEnrollmentPeriod = (data) => api.patch('/admin/settings/enrollment-period', data).then((r) => r.data);
export const updateRequiredDocuments = (documents) =>
  api.patch('/admin/settings/required-documents', { documents }).then((r) => r.data);

// ---------- School Settings ----------
export const getSchoolSettings = () => api.get('/admin/school-settings').then((r) => r.data);
export const createSchoolYear = (data) => api.post('/admin/school-settings/school-years', data).then((r) => r.data);
export const activateSchoolYear = (id) =>
  api.patch(`/admin/school-settings/school-years/${id}/activate`).then((r) => r.data);
export const updateSchoolYearEndDate = (id, closesAt) =>
  api.patch(`/admin/school-settings/school-years/${id}/end-date`, { closesAt }).then((r) => r.data);
export const createSection = (data) => api.post('/admin/school-settings/sections', data).then((r) => r.data);
export const updateSectionCapacity = (id, capacity) =>
  api.patch(`/admin/school-settings/sections/${id}/capacity`, { capacity }).then((r) => r.data);
export const deleteSection = (id) => api.delete(`/admin/school-settings/sections/${id}`).then((r) => r.data);

// ---------- Walk-in Enrollment ----------
export const getRequiredDocumentTypes = () => api.get('/admin/walk-in-enrollment/required-documents').then((r) => r.data);
export const lookupStudentByLrn = (lrn) =>
  api.get('/admin/walk-in-enrollment/lookup-by-lrn', { params: { lrn } }).then((r) => r.data);
export const createWalkInEnrollment = (data) => api.post('/admin/walk-in-enrollment', data).then((r) => r.data);