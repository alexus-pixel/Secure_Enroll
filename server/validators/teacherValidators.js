const { z } = require('zod');
const { isValidMajor } = require('../lib/degreeReference');

const phPhone = z
  .string()
  .trim()
  .regex(/^(0|\+63)9\d{9}$/, 'Enter a valid Philippine mobile number (e.g. 09171234567).');

// Kept as a plain ZodObject (no .refine() yet) specifically so
// .partial() below still works — .refine() returns a ZodEffects,
// which has no .partial() method, so it has to be layered on
// separately for create vs. update rather than baked in here.
//
// degree is a general string check, not an enum: a submission is
// either one of the known codes (BEEd, BSEd, ...) or whatever an
// admin typed after choosing "Other" on the form, and both are
// legitimate. The degree/major *pairing* is still checked below —
// this only stops accepting an empty or absurdly long value.
const teacherFields = z.object({
  firstName: z.string().trim().min(1).max(60),
  middleName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().min(1).max(60),
  email: z.string().trim().toLowerCase().email().max(255),
  contactNumber: phPhone,
  degree: z.string().trim().min(2).max(120).optional(),
  major: z.string().trim().max(120).optional(),
  dateHired: z.string().date().optional(),
  sex: z.enum(['male', 'female']).optional(),
  prcLicenseNumber: z.string().trim().max(30).optional(),
  address: z.string().trim().max(255).optional(),
  maxPeriodsPerDay: z.coerce.number().int().positive().max(20).optional(),
  subjectIds: z.array(z.coerce.number().int().positive()).default([]),
});

const degreeMajorMatch = (data) => !data.degree || !data.major || isValidMajor(data.degree, data.major);
const degreeMajorMatchIssue = { message: 'That major does not belong to the selected degree.', path: ['major'] };

const createTeacher = teacherFields.refine(degreeMajorMatch, degreeMajorMatchIssue);

// status only applies to editing an existing teacher — a new
// teacher is always created active, same as the Users page defaults
// a newly created account to active rather than asking up front.
const updateTeacher = teacherFields.partial().extend({
  isActive: z.boolean().optional(),
  status: z.enum(['active', 'locked', 'retired']).optional(),
}).refine(degreeMajorMatch, degreeMajorMatchIssue);

const teacherIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

const checkEmailQuery = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
});

module.exports = { createTeacher, updateTeacher, teacherIdParam, checkEmailQuery };