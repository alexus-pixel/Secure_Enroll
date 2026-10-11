const { z } = require('zod');

const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM.');

const createSubject = z.object({
  name: z.string().trim().min(1).max(80),
  gradeLevelId: z.coerce.number().int().positive(),
  isDomain: z.boolean().default(false),
});

// One weekly recurring block. days: 1=Mon .. 5=Fri. An "adviser"
// row (role_type) carries no session/time/teacher-period conflict,
// since it represents "owns this section all day" rather than one
// period — the schema reflects that by making session/time
// required only when roleType is 'subject'.
const scheduleEntryBase = z.object({
  sectionId: z.coerce.number().int().positive(),
  // Optional: a "+ Add Period" blank placeholder has neither yet —
  // subject/teacher only become required once something real is
  // actually being assigned into it (enforced below, in superRefine,
  // rather than here, since whether they're required depends on
  // whether this is a blank slot or a real assignment).
  subjectId: z.coerce.number().int().positive().nullish(),
  teacherId: z.coerce.number().int().positive().nullish(),
  roleType: z.enum(['subject', 'adviser']).default('subject'),
  session: z.enum(['morning', 'afternoon']).optional(),
  // A blank placeholder starts with no days at all — "at least one
  // day" is only required once a subject/teacher is actually being
  // assigned, checked in superRefine instead of here.
  days: z.array(z.coerce.number().int().min(1).max(5)).default([]),
  startTime: timeString.optional(),
  endTime: timeString.optional(),
  room: z.string().trim().max(40).nullish(),
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
    if (val.startTime && val.endTime && val.startTime >= val.endTime) {
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'End time must be after start time.' });
    }
  }
});

const updateScheduleEntry = scheduleEntryBase.partial();

const conflictCheckQuery = z.object({
  teacherId: z.coerce.number().int().positive(),
  days: z.string().min(1), // comma-separated, parsed in controller
  startTime: timeString,
  endTime: timeString,
  excludeEntryId: z.coerce.number().int().positive().optional(),
});

module.exports = { createSubject, createScheduleEntry, updateScheduleEntry, conflictCheckQuery };