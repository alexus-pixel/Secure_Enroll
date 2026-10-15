const { z } = require('zod');

const phPhone = z
  .string()
  .trim()
  .regex(/^(0|\+63)9\d{9}$/, 'Enter a valid Philippine mobile number (e.g. 09171234567).');

const lrnLookupQuery = z.object({
  lrn: z.string().trim().min(6).max(20),
});

// A walk-in parent must have an account, and the Gmail the admin
// types here IS that account's login. The parent dashboard finds
// applications through the logged-in user's id, so whatever address
// is entered at the desk is exactly what the parent signs in with.
const gmailAddress = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(255)
  .refine((v) => /@gmail\.com$/.test(v), 'The parent’s Gmail address (@gmail.com) is required.');

const guardianFields = {
  guardianEmail: gmailAddress,
  guardianFirstName: z.string().trim().min(1).max(60),
  guardianMiddleName: z.string().trim().max(60).optional(),
  guardianLastName: z.string().trim().min(1).max(60),
  guardianContactNumber: phPhone,
  guardianAddress: z.string().trim().min(1).max(255),
  guardianValidIdType: z.string().trim().max(40).optional(),
  relationship: z.string().trim().max(30).optional(),
};

const sharedFields = {
  gradeLevelId: z.coerce.number().int().positive(),
  sectionId: z.coerce.number().int().positive().optional(),
  physicalDocTypes: z.array(z.string()).default([]),
};

const createWalkInNewStudent = z.object({
  isNewStudent: z.literal(true),
  firstName: z.string().trim().min(1).max(60),
  middleName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().min(1).max(60),
  birthDate: z.string().date(),
  sex: z.enum(['M', 'F']),
  lrn: z.string().trim().min(6).max(20).optional(),
  ...guardianFields,
  ...sharedFields,
});

const createWalkInExistingStudent = z.object({
  isNewStudent: z.literal(false),
  existingStudentId: z.coerce.number().int().positive(),
  ...guardianFields,
  ...sharedFields,
});

const createWalkInEnrollment = z.discriminatedUnion('isNewStudent', [
  createWalkInNewStudent, createWalkInExistingStudent,
]);

module.exports = { lrnLookupQuery, createWalkInEnrollment };