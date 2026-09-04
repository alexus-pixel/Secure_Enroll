// ASSUMPTION: your existing client/src/api/client.js default-exports the
// configured axios instance (the one with baseURL http://localhost:5000/api
// and the auth token attached automatically). Adjust this import if it's
// exported differently.
import api from './client';

// Users
export const getUsers = (params) => api.get('/admin/users', { params }).then((r) => r.data);
export const getRoles = () => api.get('/admin/roles').then((r) => r.data);
export const createUser = (data) => api.post('/admin/users', data).then((r) => r.data);
export const updateUserRole = (id, roleId) =>
  api.patch(`/admin/users/${id}/role`, { roleId }).then((r) => r.data);
export const setUserActive = (id, isActive) =>
  api.patch(`/admin/users/${id}/status`, { isActive }).then((r) => r.data);

// Audit log
export const getAuditLogs = (params) => api.get('/admin/audit-logs', { params }).then((r) => r.data);

// School settings
export const getSchoolYears = () => api.get('/admin/school-years').then((r) => r.data);
export const createSchoolYear = (data) => api.post('/admin/school-years', data).then((r) => r.data);
export const setActiveSchoolYear = (id) =>
  api.patch(`/admin/school-years/${id}/activate`).then((r) => r.data);
export const getGradeLevels = () => api.get('/admin/grade-levels').then((r) => r.data);
export const createGradeLevel = (data) => api.post('/admin/grade-levels', data).then((r) => r.data);
export const getSections = (gradeLevelId) =>
  api.get('/admin/sections', { params: { gradeLevelId } }).then((r) => r.data);
export const createSection = (data) => api.post('/admin/sections', data).then((r) => r.data);
export const updateSection = (id, data) => api.patch(`/admin/sections/${id}`, data).then((r) => r.data);
