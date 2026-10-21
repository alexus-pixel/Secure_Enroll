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
  // Optional: when omitted, the school year automatically ends 10
  // months after opensAt rather than requiring an admin to type an
  // end date up front.
  closesAt: c.isoDate('Closing date').optional(),
}).refine((v) => !v.closesAt || v.closesAt > v.opensAt, {
  message: 'Closing date must be after the opening date.',
  path: ['closesAt'],
}).refine((v) => Number(String(v.opensAt).slice(0, 4)) >= 2026, {
  message: 'School years for 2025 or earlier can\u2019t be added.',
  path: ['opensAt'],
}).refine((v) => !v.closesAt || Number(String(v.closesAt).slice(0, 4)) === Number(String(v.opensAt).slice(0, 4)) + 1, {
  // "if the school year is 2026-2027, the system only shows year 2027"
  message: 'A school year ends in the year after it starts, e.g. starts in 2026 and ends in 2027.',
  path: ['closesAt'],
}).refine((v) => !v.label || v.label === schoolYearLabelFor(v.opensAt), {
  message: 'The school year name has to match its start date.',
  path: ['label'],
});

const createSection = z.object({
  name: c.safeText('Section name', 40),
  gradeLevelId: c.id('Grade level'),
  capacity: z.coerce.number().int('Capacity must be a whole number.').positive('Capacity must be at least 1.').max(500, 'Capacity can be at most 500.'),
});

const updateSectionCapacity = z.object({
  capacity: z.coerce.number().int('Capacity must be a whole number.').positive('Capacity must be at least 1.').max(500, 'Capacity can be at most 500.'),
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
  // The first day of classes, which is its own date: enrollment normally
  // closes before the children walk in.
  classesStartOn: c.isoDate('First day of classes').optional(),
}).refine((v) => !v.opensAt || v.closesAt > v.opensAt, {
  message: 'Closing date must be after the opening date.',
  path: ['closesAt'],
}).refine((v) => !v.opensAt || Number(String(v.closesAt).slice(0, 4)) === Number(String(v.opensAt).slice(0, 4)) + 1, {
  // The same rule the add-a-school-year form obeys, so moving the start date
  // cannot leave a year that runs over three calendar years.
  message: 'A school year ends in the year after it starts, e.g. starts in 2026 and ends in 2027.',
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
}).refine(
  (v) => !v.opensAt || !v.closesAt
    || Number(String(v.closesAt).slice(0, 4)) === Number(String(v.opensAt).slice(0, 4)) + 1,
  {
    message: 'A school year ends in the year after it starts, e.g. starts in 2026 and ends in 2027.',
    path: ['closesAt'],
  }
);

module.exports = {
  addRequiredDocument, updateRequiredDocument, documentIdParam, rolloverSchoolYear,
  updateEnrollmentPeriod, createSchoolYear, createSection,
  updateSectionCapacity, updateSectionName, updateSchoolYearDates, updateRequiredDocuments,
  setSectionAdviser, schoolYearLabelFor,
};
