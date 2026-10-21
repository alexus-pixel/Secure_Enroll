import api from './client';

// Teacher-management calls added for the activate/deactivate button
// and the schedule hand-over it depends on. The older teacher calls
// still live in api/admin.js alongside the rest of the admin area.

// Flips the plain is_active flag. Deactivating comes back 409 with
// { reason: 'has_schedule', assignments: [...] } while the teacher
// still has periods on the active school year's timetable;
// reactivating is always allowed.
//
// Activating with restoreSchedule = true also moves back the schedule
// that was handed over when this teacher was deactivated, and the reply
// carries a `restore` report: { restoredCount, restored, skipped,
// clashes, message }.
export const setTeacherActive = (id, isActive, restoreSchedule = false) =>
  api.patch(`/admin/teachers/${id}/active`, {
    isActive, ...(restoreSchedule ? { restoreSchedule: true } : {}),
  }).then((r) => r.data);

// Is there a hand-over waiting to be given back to this teacher?
// { pending: false } or { pending: true, transfer: { toTeacherName,
// count, entries: [{ label }], transferredAt } }.
export const getPendingTransfer = (id) =>
  api.get(`/admin/teachers/${id}/pending-transfer`).then((r) => r.data);

// What this teacher would have to hand over before they can be deactivated,
// and who could take each piece on:
//   { teacherName, subjects: [{ subjectId, subjectName, gradeLevelName,
//       periods: [{ label }], candidates: [{ id, name, eligible, reason }] }],
//     advisories: [{ sectionId, sectionName, gradeLevelName, candidates }],
//     nothingToHandOver, blocked: [names with no eligible teacher] }
export const getTeacherHandover = (id) =>
  api.get(`/admin/teachers/${id}/handover`).then((r) => r.data);

// Hands the work over and deactivates the teacher in one go.
//   subjects: [{ subjectId, teacherId }]  advisers: [{ sectionId, teacherId }]
export const handOverTeacher = (id, { subjects = [], advisers = [] }) =>
  api.post(`/admin/teachers/${id}/handover`, { subjects, advisers }).then((r) => r.data);

// Moves every one of this teacher's active-year schedule entries,
// plus the subject links they need, to another teacher. Comes back
// 409 { reason: 'time_clash' } if the receiving teacher would end
// up double-booked.
export const transferTeacherSchedule = (id, toTeacherId) =>
  api.post(`/admin/teachers/${id}/transfer-schedule`, { toTeacherId }).then((r) => r.data);
