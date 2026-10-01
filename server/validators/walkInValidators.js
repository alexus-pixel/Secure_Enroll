const { z } = require('zod');

const phPhone = z
  .string()
  .trim()
  .regex(/^(0|\+63)9\d{9}$/, 'Enter a valid Philippine mobile number (e.g. 09171234567).');

const lrnLookupQuery = z.object({
  lrn: z.string().trim().min(6).max(20),
});

const guardianFields = {
  guardianEmail: z.string().trim().toLowerCase().email().max(255),
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
