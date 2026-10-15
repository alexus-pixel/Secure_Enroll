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

const createSchoolYear = z.object({
  label: z.string().trim().regex(/^\d{4}-\d{4}$/, 'Use the form 2026-2027.'),
  opensAt: c.isoDate('Opening date'),
  // Optional: when omitted, the school year automatically ends 10
  // months after opensAt rather than requiring an admin to type an
  // end date up front.
  closesAt: c.isoDate('Closing date').optional(),
}).refine((v) => !v.closesAt || v.closesAt > v.opensAt, {
  message: 'Closing date must be after the opening date.',
  path: ['closesAt'],
}).refine((v) => Number(v.label.slice(0, 4)) >= 2026, {
  message: 'School years for 2025 or earlier can\u2019t be added.',
  path: ['label'],
}).refine((v) => Number(v.label.slice(5, 9)) === Number(v.label.slice(0, 4)) + 1, {
  message: 'A school year spans exactly one year, e.g. 2026-2027.',
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

const updateSchoolYearEndDate = z.object({
  closesAt: c.isoDate('Closing date'),
});

const updateRequiredDocuments = z.object({
  documents: z.array(
    z.object({
      id: c.id('Document'),
      isRequired: z.boolean(),
    })
  ).min(1).max(30),
});

module.exports = {
  updateEnrollmentPeriod, createSchoolYear, createSection,
  updateSectionCapacity, updateSchoolYearEndDate, updateRequiredDocuments,
};
