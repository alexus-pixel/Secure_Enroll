import api from './client';

// The walk-in form is shared by the admin and registrar portals; only the
// URL prefix differs (each role is checked by its own permission on the server).
export function walkInApi(base) {
  return {
    gradeLevels: () => api.get(`${base}/grade-levels`).then((r) => r.data),
    sections: (gradeLevelId) =>
      api.get(`${base}/sections`, { params: { gradeLevelId } }).then((r) => r.data),
    documentTypes: () => api.get(`${base}/required-documents`).then((r) => r.data),
    lookupByLrn: (lrn) => api.get(`${base}/lookup-by-lrn`, { params: { lrn } }).then((r) => r.data),
    // Is this Gmail already a parent account? Is this learner already on file?
    guardianLookup: (email) => api.get(`${base}/guardian-lookup`, { params: { email } }).then((r) => r.data),
    studentDuplicate: (params) => api.get(`${base}/student-duplicate`, { params }).then((r) => r.data),
    create: (data) => api.post(base, data).then((r) => r.data),
  };
}

export const adminWalkIn = walkInApi('/admin/walk-in-enrollment');
export const registrarWalkIn = walkInApi('/registrar/walk-in-enrollment');
