import api from './client';

// Subject management for one grade level, for the active school year:
// the subjects themselves plus the per-grade ceiling on how many of
// them that grade may have (grade_levels.max_subjects).

// Everything the subject panel shows in one reply:
// { gradeLevelId, gradeLevelName, maxSubjects, count,
//   subjects: [{ id, name, is_domain, scheduled_count, teacher_count }] }
export const getSubjectSettings = (gradeLevelId, schoolYearId) =>
  api.get(`/admin/schedules/grades/${gradeLevelId}/subject-settings`, { params: { schoolYearId } })
    .then((r) => r.data);

// Just the subjects of one grade level for one school year, in the
// order they should be offered: learning domains first, then by name.
// This is what fills the Subject dropdown in the Add/Edit period
// drawer, so the drawer always offers exactly the subjects that grade
// actually has that year — [{ id, name, is_domain }].
export const getGradeSubjects = (gradeLevelId, schoolYearId) =>
  api.get(`/admin/schedules/grades/${gradeLevelId}/subjects`, { params: { schoolYearId } })
    .then((r) => r.data);

// Who advises one section (sections.adviser_teacher_id, set from
// School Settings). It lives on the schedules router, behind
// schedule.manage, so the registrar can see it while viewing a
// schedule: { sectionId, sectionName, gradeLevelId, gradeLevelName,
// adviserTeacherId, adviserName } — both adviser fields are null for
// a section that has no adviser yet.
export const getSectionAdviser = (sectionId, schoolYearId) =>
  api.get(`/admin/schedules/sections/${sectionId}/adviser`, { params: { schoolYearId } })
    .then((r) => r.data);

export const addSubject = ({ name, gradeLevelId, isDomain = false }) =>
  api.post('/admin/schedules/subjects', { name, gradeLevelId, isDomain }).then((r) => r.data);

// Renaming is allowed even while the subject is on the timetable —
// the periods reference its id, so they simply show the new name.
export const updateSubject = (id, { name, isDomain }) =>
  api.patch(`/admin/schedules/subjects/${id}`, { name, isDomain }).then((r) => r.data);

export const removeSubject = (id) =>
  api.delete(`/admin/schedules/subjects/${id}`).then((r) => r.data);

export const setMaxSubjects = (gradeLevelId, maxSubjects) =>
  api.patch(`/admin/schedules/grades/${gradeLevelId}/max-subjects`, { maxSubjects })
    .then((r) => r.data);

// The server answers a broken rule with a sentence plus a reason code
// ('subject_limit_reached', 'limit_below_current', 'subject_in_schedule',
// 'duplicate_subject_name'), and a broken form with a list of field
// errors. Both end up as one line the panel can show.
export function subjectError(err, fallback) {
  const data = err?.response?.data;
  return data?.errors?.map((e) => e.message).join(' ') || data?.message || fallback;
}

export const errorReason = (err) => err?.response?.data?.reason || null;
