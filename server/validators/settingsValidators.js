const { z } = require('zod');
const c = require('./common');

const updateEnrollmentPeriod = z.object({
  enrollmentOpen: z.boolean({ invalid_type_error: 'enrollmentOpen must be true or false.' }),
  opensAt: c.isoDate('Opening date'),
  closesAt: c.isoDate('Closing date'),
}).refine((v) => v.closesAt > v.opensAt, {
  message: 'Closing date must be after the opening date.',
  path: ['closesAt'],
});

// The label is not typed any more: it is the two years of the dates, so
// "2026-2027" always matches a year that starts in 2026 and ends in 2027.
// A label may still be sent (older clients, scripts) and is then checked
// against the dates rather than trusted.
const schoolYearLabelFor = (opensAt) => {
  const start = Number(String(opensAt).slice(0, 4));
  return `${start}-${start + 1}`;
};

const createSchoolYear = z.object({
  label: z.string().trim().regex(/^\d{4}-\d{4}$/, 'Use the form 2026-2027.').optional(),
  opensAt: c.isoDate('Opening date'),
  // This is the enrollment window's END, not the end of the whole school year.
  // Optional: when omitted the server defaults it to three days after the
  // opening date (see db/admin/schoolSettings.js), the usual length of an
  // enrollment period. Being a short window it sits in the same calendar year
  // as the opening date, so there is no "ends the year after" rule on it.
  closesAt: c.isoDate('Closing date').optional(),
}).refine((v) => !v.closesAt || v.closesAt > v.opensAt, {
  message: 'Closing date must be after the opening date.',
  path: ['closesAt'],
}).refine((v) => Number(String(v.opensAt).slice(0, 4)) >= 2026, {
  message: 'School years for 2025 or earlier can\u2019t be added.',
  path: ['opensAt'],
}).refine((v) => !v.label || v.label === schoolYearLabelFor(v.opensAt), {
  message: 'The school year name has to match its start date.',
  path: ['label'],
});

// A class of more than 60 is not a class anybody can teach, and DepEd's own
// ceiling for elementary sections sits in that range, so the form refuses a
// number that would only ever be a typo.
const SECTION_MAX = 60;
const sectionCapacity = () => z.coerce.number()
  .int('Capacity must be a whole number.')
  .positive('Capacity must be at least 1.')
  .max(SECTION_MAX, `A section can hold at most ${SECTION_MAX} learners.`);

// The school's own opening and closing hours. The pair is judged in
// lib/schoolHours.js, which also refuses hours that would strand periods
// already on a timetable; this only checks the shape.
const schoolHours = z.object({
  opensAt: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM, for example 06:00.'),
  closesAt: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM, for example 18:00.'),
});

const createSection = z.object({
  name: c.safeText('Section name', 40),
  gradeLevelId: c.id('Grade level'),
  capacity: sectionCapacity(),
});

const updateSectionCapacity = z.object({
  capacity: sectionCapacity(),
});

// The same name rule the add-a-section form uses, so renaming cannot
// sneak in a name that could not have been typed in the first place.
const updateSectionName = z.object({
  name: c.safeText('Section name', 40),
});

// Moving the dates of one school year. The end date is always allowed; the
// start date only reaches the database while the school year has not begun
// yet, which is a question about today and so is settled on the server (see
// db/admin/schoolSettings.js) rather than here.
const updateSchoolYearDates = z.object({
  closesAt: c.isoDate('Closing date'),
  // Sent when the start date is being moved too, and when an
  // automatically-created school year has its provisional dates confirmed.
  opensAt: c.isoDate('Opening date').optional(),
  // The first day of classes, its own stored date, no longer typed on the
  // two-date form but still accepted from API callers. Enrollment closes on or
  // before classes begin.
  classesStartOn: c.isoDate('First day of classes').optional(),
}).refine((v) => !v.opensAt || v.closesAt > v.opensAt, {
  message: 'Closing date must be after the opening date.',
  path: ['closesAt'],
}).refine((v) => !v.classesStartOn || v.closesAt <= v.classesStartOn, {
  // The enrollment period must end on or before the first day of classes.
  message: 'The enrollment period has to end on or before the first day of classes.',
  path: ['closesAt'],
});

const setSectionAdviser = z.object({
  // null clears the adviser.
  teacherId: z.union([c.id('Teacher'), z.null()]),
});

const updateRequiredDocuments = z.object({
  documents: z.array(
    z.object({
      id: c.id('Document'),
      isRequired: z.boolean(),
      // Who is asked for it: a first-time learner, a returning one, or both.
      // Left out means "leave it as it is".
      appliesTo: z.enum(['all', 'new', 'returning']).optional(),
    })
  ).min(1).max(30),
});

// The name of a document the school asks for: plain text, long enough to mean
// something, short enough for the column.
const documentLabel = z.string({ required_error: 'Enter the name of the document.' })
  .transform((v) => v.trim().replace(/\s+/g, ' '))
  .refine((v) => v.length >= 3, 'The document name is too short.')
  .refine((v) => v.length <= 80, 'The document name is too long (up to 80 characters).')
  .refine((v) => !/[<>]/.test(v), 'The document name cannot contain < or >.')
  .refine((v) => /[\p{L}]/u.test(v), 'The document name needs at least one letter.');

const addRequiredDocument = z.object({
  label: documentLabel,
  isRequired: z.boolean().optional().default(true),
});

const updateRequiredDocument = z.object({
  label: documentLabel.optional(),
  isRequired: z.boolean().optional(),
}).refine((v) => v.label !== undefined || v.isRequired !== undefined, 'Nothing to change.');

const documentIdParam = z.object({ id: c.id('Document') });

/**
 * Starting the next school year by hand. The dates may be left out, in which
 * case they are worked out from the year being rolled over; when they are
 * given they obey the same rules as adding a school year, because the row that
 * comes out is the same kind of row.
 */
const rolloverSchoolYear = z.object({
  opensAt: c.isoDate('Opening date').optional(),
  closesAt: c.isoDate('Closing date').optional(),
}).refine((v) => !v.opensAt || !v.closesAt || v.closesAt > v.opensAt, {
  message: 'Closing date must be after the opening date.',
  path: ['closesAt'],
});

module.exports = {
  addRequiredDocument, updateRequiredDocument, documentIdParam, rolloverSchoolYear,
  updateEnrollmentPeriod, createSchoolYear, createSection,
  updateSectionCapacity, updateSectionName, updateSchoolYearDates, updateRequiredDocuments,
  setSectionAdviser, schoolYearLabelFor, schoolHours,
};
