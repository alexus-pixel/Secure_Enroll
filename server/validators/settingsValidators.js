const { z } = require('zod');

const updateEnrollmentPeriod = z.object({
  enrollmentOpen: z.boolean(),
  opensAt: z.string().date(),
  closesAt: z.string().date(),
}).refine((v) => v.closesAt > v.opensAt, {
  message: 'Closing date must be after the opening date.',
  path: ['closesAt'],
});

const createSchoolYear = z.object({
  label: z.string().trim().regex(/^\d{4}-\d{4}$/, 'Use the form 2026-2027.'),
  opensAt: z.string().date(),
  // Optional: when omitted, the school year automatically ends 10
  // months after opensAt rather than requiring an admin to type an
  // end date up front.
  closesAt: z.string().date().optional(),
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
  name: z.string().trim().min(1).max(40),
  gradeLevelId: z.coerce.number().int().positive(),
  capacity: z.coerce.number().int().positive().max(500),
});

const updateSectionCapacity = z.object({
  capacity: z.coerce.number().int().positive().max(500),
});

const updateSchoolYearEndDate = z.object({
  closesAt: z.string().date(),
});

const updateRequiredDocuments = z.object({
  documents: z.array(
    z.object({
      id: z.coerce.number().int().positive(),
      isRequired: z.boolean(),
    })
  ).min(1),
});

module.exports = {
  updateEnrollmentPeriod, createSchoolYear, createSection,
  updateSectionCapacity, updateSchoolYearEndDate, updateRequiredDocuments,
};
