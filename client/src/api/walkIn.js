import api from './client';

// Walk-in enrollment is the registrar's job only (the administrator has no
// access to it, on the server or in the portal).
export function walkInApi(base) {
  return {
    gradeLevels: () => api.get(`${base}/grade-levels`).then((r) => r.data),
    sections: (gradeLevelId) =>
      api.get(`${base}/sections`, { params: { gradeLevelId } }).then((r) => r.data),
    // `kind` is 'new' or 'returning': the checklist differs by learner type.
    documentTypes: (kind) =>
      api.get(`${base}/required-documents`, { params: kind ? { kind } : {} }).then((r) => r.data),
    lookupByLrn: (lrn) => api.get(`${base}/lookup-by-lrn`, { params: { lrn } }).then((r) => r.data),
    // Is this Gmail already a parent account? Is this learner already on file?
    guardianLookup: (email) => api.get(`${base}/guardian-lookup`, { params: { email } }).then((r) => r.data),
    studentDuplicate: (params) => api.get(`${base}/student-duplicate`, { params }).then((r) => r.data),
    create: (data) => api.post(base, data).then((r) => r.data),
  };
}

export const registrarWalkIn = walkInApi('/registrar/walk-in-enrollment');
