const { z } = require('zod');
const { isValidMajor } = require('../lib/degreeReference');

const c = require('./common');

const phPhone = c.phPhone;

// Hired no earlier than 1950 and not in the future.
const dateHired = c.isoDate('Date hired').refine((v) => v >= '1950-01-01', 'Date hired is too far in the past.')
  .refine((v) => v <= new Date().toISOString().slice(0, 10), 'Date hired cannot be in the future.');

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
  firstName: c.personName('First name'),
  middleName: c.optionalPersonName('Middle name'),
  lastName: c.personName('Last name'),
  email: c.email,
  contactNumber: phPhone,
  degree: z.string().trim().min(2).max(120).refine((v) => !/[<>]/.test(v), 'Degree cannot contain < or >.').optional(),
  major: z.string().trim().max(120).refine((v) => !/[<>]/.test(v), 'Major cannot contain < or >.').optional(),
  dateHired: z.preprocess((v) => (v === '' ? undefined : v), dateHired.optional()),
  sex: z.enum(['male', 'female']).optional(),
  prcLicenseNumber: z.preprocess((v) => (v === '' ? undefined : v),
    z.string().trim().max(30, 'PRC license number is too long.')
      .regex(/^[A-Za-z0-9 -]+$/, 'PRC license number: letters, numbers, spaces and - only.').optional()),
  address: c.optionalSafeText('Address', 255),
  maxPeriodsPerDay: z.coerce.number().int().positive().max(20).optional(),
  subjectIds: z.array(c.id('Subject')).max(40, 'Too many subjects selected.')
    .refine((list) => new Set(list).size === list.length, 'A subject was selected twice.')
    .default([]),
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
  id: c.id('Teacher'),
});

const checkEmailQuery = z.object({
  email: c.email,
});

module.exports = { createTeacher, updateTeacher, teacherIdParam, checkEmailQuery };