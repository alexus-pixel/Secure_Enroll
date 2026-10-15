const { z } = require('zod');
const c = require('./common');

const lrnLookupQuery = z.object({
  lrn: c.lrn,
});

// A walk-in parent must have an account, and the Gmail the admin
// types here IS that account's login. The parent dashboard finds
// applications through the logged-in user's id, so whatever address
// is entered at the desk is exactly what the parent signs in with.
const gmailAddress = c.email
  .refine((v) => /@gmail\.com$/.test(v), 'The parent\u2019s Gmail address (@gmail.com) is required.');

const guardianFields = {
  guardianEmail: gmailAddress,
  guardianFirstName: c.personName('Guardian first name'),
  guardianMiddleName: c.optionalPersonName('Guardian middle name'),
  guardianLastName: c.personName('Guardian last name'),
  guardianContactNumber: c.phPhone,
  guardianAddress: c.safeText('Home address', 255),
  guardianValidIdType: c.optionalSafeText('Valid ID type', 40),
  relationship: c.relationship.optional(),
};

// Document codes are 1-40 lowercase letters, digits or underscores; the
// controller checks them against the real list of document types.
const docCode = z.string().regex(/^[a-z0-9_]{1,40}$/, 'Unknown document type.');

const sharedFields = {
  gradeLevelId: c.id('Grade level'),
  sectionId: c.id('Section').optional(),
  physicalDocTypes: z.array(docCode).max(12)
    .refine((list) => new Set(list).size === list.length, 'Each document can be listed only once.')
    .default([]),
};

const createWalkInNewStudent = z.object({
  isNewStudent: z.literal(true),
  firstName: c.personName('First name'),
  middleName: c.optionalPersonName('Middle name'),
  lastName: c.personName('Last name'),
  birthDate: c.birthDate,
  sex: z.enum(['M', 'F'], { errorMap: () => ({ message: 'Choose Male or Female.' }) }),
  lrn: z.preprocess((v) => (v === '' ? undefined : v), c.lrn.optional()),
  ...guardianFields,
  ...sharedFields,
});

const createWalkInExistingStudent = z.object({
  isNewStudent: z.literal(false),
  existingStudentId: c.id('Student'),
  ...guardianFields,
  ...sharedFields,
});

const createWalkInEnrollment = z.discriminatedUnion('isNewStudent', [
  createWalkInNewStudent, createWalkInExistingStudent,
]);

module.exports = { lrnLookupQuery, createWalkInEnrollment };
