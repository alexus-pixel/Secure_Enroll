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
  // A teacher may genuinely have no email address: an empty field
  // is stored as NULL rather than rejected. Sending null explicitly
  // clears an address already on file.
  email: z.preprocess((v) => (v === '' ? null : v), c.email.nullable().optional()),
  contactNumber: phPhone,
  degree: z.string().trim().min(2).max(120).refine((v) => !/[<>]/.test(v), 'Degree cannot contain < or >.').optional(),
  major: z.string().trim().max(120).refine((v) => !/[<>]/.test(v), 'Major cannot contain < or >.').optional(),
  dateHired: z.preprocess((v) => (v === '' ? undefined : v), dateHired.optional()),
  sex: z.enum(['male', 'female']).optional(),
  // A PRC professional licence number is seven digits, nothing else.
  prcLicenseNumber: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v),
    z.preprocess((v) => (v === '' ? undefined : v),
      z.string()
        .regex(/^\d{7}$/, 'PRC license number must be exactly 7 digits.')
        .optional())),
  address: c.optionalSafeText('Address', 255),
  // A full teaching day is ten to twelve periods. Anything outside that is
  // either not a working day or more than a 6 AM - 6 PM day holds.
  maxPeriodsPerDay: z.coerce.number({ invalid_type_error: 'Periods per day must be a whole number.' })
    .int('Periods per day must be a whole number.')
    .min(10, 'A teacher handles at least 10 periods a day.')
    .max(12, 'A teacher handles at most 12 periods a day.')
    .optional(),
  subjectIds: z.array(c.id('Subject')).max(40, 'Too many subjects selected.')
    .refine((list) => new Set(list).size === list.length, 'A subject was selected twice.')
    .default([]),
});

const degreeMajorMatch = (data) => !data.degree || !data.major || isValidMajor(data.degree, data.major);
const degreeMajorMatchIssue = { message: 'That major does not belong to the selected degree.', path: ['major'] };

const createTeacher = teacherFields.refine(degreeMajorMatch, degreeMajorMatchIssue);

/**
 * Editing a teacher's details. Whether they are still teaching is deliberately
 * NOT editable here: deactivating somebody means handing their advisory class
 * and every subject they teach to colleagues who are qualified and have room,
 * which is what the Deactivate button does. Letting a plain edit flip the flag
 * would leave a timetable full of classes with an inactive teacher's name
 * against them, and nobody able to take them over.
 */
const updateTeacher = teacherFields.partial().refine(degreeMajorMatch, degreeMajorMatchIssue);

const teacherIdParam = z.object({
  id: c.id('Teacher'),
});

const checkEmailQuery = z.object({
  email: c.email,
});

const setTeacherActive = z.object({
  isActive: z.boolean({ required_error: 'Choose whether this teacher is active or inactive.' }),
  // Only meaningful when activating: move the schedule that was handed
  // over when this teacher was deactivated back to them. Left out (or
  // false) nothing is moved, because somebody else may have been
  // teaching those classes ever since.
  restoreSchedule: z.boolean().optional(),
});

const transferSchedule = z.object({
  toTeacherId: c.id('Teacher'),
});

/**
 * Who takes over what, when a teacher is deactivated. Every subject they
 * teach and every section they advise has to name a receiving teacher; the
 * server checks each one again before anything moves.
 */
const handover = z.object({
  subjects: z.array(z.object({
    subjectId: c.id('Subject'),
    teacherId: c.id('Teacher'),
  })).max(60).default([]),
  advisers: z.array(z.object({
    sectionId: c.id('Section'),
    teacherId: c.id('Teacher'),
  })).max(40).default([]),
});

module.exports = {
  createTeacher, updateTeacher, teacherIdParam, checkEmailQuery,
  setTeacherActive, transferSchedule, handover,
};