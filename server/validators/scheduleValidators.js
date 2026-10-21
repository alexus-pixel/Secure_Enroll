const { z } = require('zod');
const c = require('./common');

const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM.');

// A period has to sit inside the half of the day its session names:
// a "morning" period that runs 21:00-22:00 is a typo, not a late
// morning. Times are 24-hour HH:MM strings, so a plain string
// compare against noon is the whole rule.
//
//   morning   - starts AND ends before 12:00 noon
//   afternoon - starts at 12:00 noon or later
//
// In both cases the end still has to come after the start.
//
// (schedule_entries.session is a CHECK-constrained
// 'morning' | 'afternoon', so those are the only two that exist.)
const NOON = '12:00';
// Every period — morning, afternoon, and a blank placeholder waiting to be
// filled — has to sit inside the hours the school is open. Those hours are
// the administrator's to set (System Settings), so they are read from
// lib/schoolHours.js rather than written here; it keeps them in memory
// because this function runs on every field of every period.
const { getHours, clock } = require('../lib/schoolHours');
const SESSION_LABELS = { morning: 'Morning', afternoon: 'Afternoon' };

/**
 * The one place the session/time rule lives. Returns null when the
 * times fit the session, or { field, message } naming the first
 * field that breaks it — used by the zod schemas below AND by the
 * database layer on the way to the insert, so the rule cannot be
 * slipped past by a request that omits a field the schema only
 * checks when it is present.
 */
function sessionTimeIssue(session, startTime, endTime) {
  const start = startTime ? String(startTime).slice(0, 5) : null;
  const end = endTime ? String(endTime).slice(0, 5) : null;

  // School hours first, because they apply whatever the session says — and
  // even before a session has been picked.
  const { opensAt, closesAt } = getHours();
  const window = `School hours are ${clock(opensAt)} to ${clock(closesAt)}.`;
  if (start && start < opensAt) {
    return { field: 'startTime', message: `Classes do not start before ${clock(opensAt)}. ${window}` };
  }
  if (start && start >= closesAt) {
    return { field: 'startTime', message: `A period cannot start at ${clock(closesAt)} or later. ${window}` };
  }
  if (end && end > closesAt) {
    return { field: 'endTime', message: `A period has to end by ${clock(closesAt)}. ${window}` };
  }
  if (end && end <= opensAt) {
    return { field: 'endTime', message: `A period cannot end at or before ${clock(opensAt)}. ${window}` };
  }

  if (!session || !SESSION_LABELS[session]) return null;
  if (session === 'morning') {
    if (start && start >= NOON) {
      return { field: 'startTime', message: 'A Morning session period must start before 12:00 noon.' };
    }
    if (end && end >= NOON) {
      return { field: 'endTime', message: 'A Morning session period must end before 12:00 noon.' };
    }
    return null;
  }
  if (start && start < NOON) {
    return { field: 'startTime', message: 'An Afternoon session period must start at 12:00 noon or later.' };
  }
  return null;
}

const createSubject = z.object({
  name: c.safeText('Subject name', 80),
  gradeLevelId: c.id('Grade level'),
  isDomain: z.boolean().default(false),
});

// Renaming one subject. Both fields are optional so the panel can
// send just the new name, or just flip the learning-domain tick,
// but sending neither is a no-op and almost certainly a bug.
const updateSubject = z.object({
  name: c.safeText('Subject name', 80).optional(),
  isDomain: z.boolean().optional(),
}).refine((v) => v.name !== undefined || v.isDomain !== undefined, {
  message: 'Nothing to change.', path: ['name'],
});

// The per-grade subject ceiling. The same 1-20 range the
// grade_levels.max_subjects CHECK enforces, so a number outside it
// comes back as a field error on the form instead of a database
// error.
const setMaxSubjects = z.object({
  maxSubjects: z.preprocess(
    (v) => (typeof v === 'string' && /^\d{1,3}$/.test(v.trim()) ? Number(v.trim()) : v),
    z.number({ required_error: 'Subject limit is required.', invalid_type_error: 'Subject limit must be a whole number.' })
      .int('Subject limit must be a whole number.')
      .min(1, 'A grade level must allow at least 1 subject.')
      .max(20, 'A grade level can allow at most 20 subjects.')
  ),
});

// One weekly recurring block. days: 1=Mon .. 5=Fri. An "adviser"
// row (role_type) carries no session/time/teacher-period conflict,
// since it represents "owns this section all day" rather than one
// period — the schema reflects that by making session/time
// required only when roleType is 'subject'.
const scheduleEntryBase = z.object({
  sectionId: c.id('Section'),
  // Optional: a "+ Add Period" blank placeholder has neither yet —
  // subject/teacher only become required once something real is
  // actually being assigned into it (enforced below, in superRefine,
  // rather than here, since whether they're required depends on
  // whether this is a blank slot or a real assignment).
  subjectId: c.id('Subject').nullish(),
  teacherId: c.id('Teacher').nullish(),
  roleType: z.enum(['subject', 'adviser']).default('subject'),
  session: z.enum(['morning', 'afternoon']).optional(),
  // A blank placeholder starts with no days at all — "at least one
  // day" is only required once a subject/teacher is actually being
  // assigned, checked in superRefine instead of here.
  days: z.array(z.coerce.number().int().min(1).max(5)).max(5)
    .refine((list) => new Set(list).size === list.length, 'Each day can be picked only once.')
    .default([]),
  startTime: timeString.optional(),
  endTime: timeString.optional(),
  room: z.preprocess((v) => (v === '' ? null : v), c.safeText('Room', 40).nullish()),
});

const createScheduleEntry = scheduleEntryBase.superRefine((val, ctx) => {
  const isRealAssignment = val.subjectId != null || val.teacherId != null;
  if (isRealAssignment && val.days.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['days'], message: 'Pick at least one day.' });
  }
  if (val.roleType === 'subject' && isRealAssignment) {
    if (!val.session) ctx.addIssue({ code: 'custom', path: ['session'], message: 'Session is required.' });
    if (!val.startTime) ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'Start time is required.' });
    if (!val.endTime) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'End time is required.' });
  }
  // Both of these apply to a blank "+ Add Period" placeholder too,
  // which carries a session and a time but no subject or teacher
  // yet: 9 PM is just as wrong on an empty morning period as on a
  // filled one, and the database CHECK would reject end <= start
  // with a 500 rather than a field error.
  if (val.roleType === 'subject' && val.startTime && val.endTime && val.startTime >= val.endTime) {
    ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'End time must be after start time.' });
  }
  if (val.roleType === 'subject') {
    const issue = sessionTimeIssue(val.session, val.startTime, val.endTime);
    if (issue) ctx.addIssue({ code: 'custom', path: [issue.field], message: issue.message });
  }
});

// On an update only the fields that are sent are checked, but the two times
// must still make sense together when both are present.
// An update may send only some of the fields, so the session/time
// rule can only be fully judged against the row as it will stand
// after the change — that merge happens in the database layer,
// which calls sessionTimeIssue() again with the merged values. What
// IS visible here (both times, or a session together with a time)
// is still refused up front so the drawer gets a field error.
const updateScheduleEntry = scheduleEntryBase.partial().superRefine((v, ctx) => {
  if (v.startTime && v.endTime && v.startTime >= v.endTime) {
    ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'End time must be after start time.' });
  }
  if (v.roleType !== 'adviser') {
    const issue = sessionTimeIssue(v.session, v.startTime, v.endTime);
    if (issue) ctx.addIssue({ code: 'custom', path: [issue.field], message: issue.message });
  }
});

const conflictCheckQuery = z.object({
  teacherId: c.id('Teacher'),
  days: z.string().regex(/^[1-5](,[1-5]){0,4}$/, 'Days must be numbers 1-5 separated by commas.'), // parsed in controller
  startTime: timeString,
  endTime: timeString,
  excludeEntryId: c.id('Entry').optional(),
}).refine((v) => v.startTime < v.endTime, {
  message: 'End time must be after start time.', path: ['endTime'],
});

module.exports = {
  createSubject, updateSubject, setMaxSubjects,
  createScheduleEntry, updateScheduleEntry, conflictCheckQuery,
  // Shared with db/admin/schedules.js, which re-checks the merged
  // row on the way to the insert/update.
  sessionTimeIssue, SESSION_LABELS,
};