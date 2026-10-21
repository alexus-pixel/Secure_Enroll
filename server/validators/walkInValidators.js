const { z } = require('zod');
const c = require('./common');

const lrnLookupQuery = z.object({
  lrn: c.lrn,
});

// "Is this Gmail already registered?" — a parent's Gmail, nothing else.
const guardianLookupQuery = z.object({
  email: c.gmail('Parent\u2019s Gmail'),
});

// "Is this learner already on file?" — a learner is identified by name alone,
// because two learners may not share one (see db/students.js).
const studentDuplicateQuery = z.object({
  firstName: c.personName('First name'),
  middleName: c.optionalPersonName('Middle name'),
  lastName: c.personName('Last name'),
});

// A walk-in parent must have an account, and the Gmail the admin
// types here IS that account's login. The parent dashboard finds
// applications through the logged-in user's id, so whatever address
// is entered at the desk is exactly what the parent signs in with.
const guardianFields = {
  guardianEmail: c.gmail('Parent\u2019s Gmail'),
  guardianConfirmEmail: c.gmail('Confirm Gmail').optional(),
  guardianFirstName: c.personName('Guardian first name'),
  guardianMiddleName: c.optionalPersonName('Guardian middle name'),
  guardianNoMiddleName: z.boolean().optional().default(false),
  guardianLastName: c.personName('Guardian last name'),
  guardianContactNumber: c.phPhone,
  guardianAddress: c.homeAddress('Home address'),
  guardianValidIdType: c.optionalSafeText('Valid ID type', 40),
  relationship: c.relationship,
  relationshipOther: c.relationshipOther,
};

// Document codes are 1-40 lowercase letters, digits or underscores; the
// controller checks them against the real list of document types.
const docCode = z.string().regex(/^[a-z0-9_]{1,40}$/, 'Unknown document type.');

const sharedFields = {
  gradeLevelId: c.id('Grade level'),
  // The desk places the learner there and then: a walk-in is finished at the
  // counter, so the section is chosen now rather than after a later review.
  sectionId: c.id('Section'),
  // Grade 1 and above have a grade level behind them to have finished. The
  // desk confirms it from the Form 137/138 in front of them; Kinder has
  // nothing to confirm, so the field is ignored there.
  gradeQualificationMet: z.boolean().optional().default(false),
  // The desk's own confirmation that the paper copies are in hand and were
  // checked against the originals. Enforced (when the school asks for any
  // document) in db/admin/walkInEnrollment.js.
  physicalDocsConfirmed: z.boolean().optional().default(false),
  physicalDocTypes: z.array(docCode).max(12)
    .refine((list) => new Set(list).size === list.length, 'Each document can be listed only once.')
    .default([]),
};

const createWalkInNewStudent = z.object({
  isNewStudent: z.literal(true),
  firstName: c.personName('First name'),
  middleName: c.optionalPersonName('Middle name'),
  noMiddleName: z.boolean().optional().default(false),
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

/**
 * The rules that span more than one field: both Gmail boxes have to agree,
 * "Other" needs the word that goes with it, and a blank middle name has to be
 * a deliberate tick rather than a skipped box.
 */
const createWalkInEnrollment = c.withRelationshipOther(
  c.withMiddleName(
    c.withMiddleName(
      z.discriminatedUnion('isNewStudent', [createWalkInNewStudent, createWalkInExistingStudent])
        .superRefine((value, ctx) => {
          if (value.guardianConfirmEmail !== undefined
            && value.guardianConfirmEmail !== value.guardianEmail) {
            ctx.addIssue({
              code: 'custom', path: ['guardianConfirmEmail'],
              message: 'The two Gmail addresses do not match.',
            });
          }
        }),
      { field: 'guardianMiddleName', noneField: 'guardianNoMiddleName', label: 'Guardian middle name' },
    ),
    { field: 'middleName', noneField: 'noMiddleName', label: 'Middle name' },
  ),
);

module.exports = {
  lrnLookupQuery, createWalkInEnrollment, guardianLookupQuery, studentDuplicateQuery,
};
