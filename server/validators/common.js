// Building blocks shared by the zod schemas, so every form in the system
// applies the same rules (and gives the same messages) for the same kind of
// value. The plain-function versions of these rules live in utils/validators.js.
const { z } = require('zod');
const {
  NAME_RE, SAFE_TEXT_RE, NAME_MIN, NAME_MAX, ADDRESS_MAX, RELATIONSHIPS,
  passwordIssues, birthDateIssue, addressIssue, isValidGmail, normalizeGmail, GMAIL_MESSAGE,
  CONTACT_MESSAGE,
} = require('../utils/validators');

const NAME_MESSAGE = 'Use letters only (spaces, . \' - are fine).';

// A person's name: letters (including ñ, é ...), spaces, . ' -
const personName = (label = 'Name') => z
  .string({ required_error: `${label} is required.`, invalid_type_error: `${label} must be text.` })
  .trim()
  .min(1, `${label} is required.`)
  .min(NAME_MIN, `${label} must be at least ${NAME_MIN} characters.`)
  .max(NAME_MAX, `${label} is too long (up to ${NAME_MAX} characters).`)
  .regex(NAME_RE, `${label}: ${NAME_MESSAGE}`)
  .refine((v) => !/\d/.test(v), `${label} cannot contain numbers.`);

// Same, but the field may be left out or empty.
const optionalPersonName = (label = 'Name') => z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  personName(label).optional(),
);

// Free text such as an address, room or section name. No < > or control characters.
const safeText = (label, max, { min = 1 } = {}) => z
  .string({ required_error: `${label} is required.`, invalid_type_error: `${label} must be text.` })
  .trim()
  .min(min, `${label} is required.`)
  .max(max, `${label} is too long (up to ${max} characters).`)
  .refine((v) => v === '' || SAFE_TEXT_RE.test(v), `${label} cannot contain < or > symbols.`);

/**
 * A home address. Narrower than free text: letters, digits and the punctuation
 * an address actually uses, long enough to be an address at all.
 */
const homeAddress = (label = 'Address') => z
  .string({ required_error: `${label} is required.`, invalid_type_error: `${label} must be text.` })
  .transform((v) => v.trim().replace(/\s+/g, ' '))
  .superRefine((v, ctx) => {
    const problem = addressIssue(v, { label });
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

const optionalSafeText = (label, max) => z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  safeText(label, max).optional(),
);

// A database id sent as a whole number or a string of digits (not 1e3, true, [] ...).
const id = (label = 'Selection') => z.preprocess(
  (v) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /^\d{1,10}$/.test(v.trim())) return Number(v.trim());
    return NaN;
  },
  z.number({ invalid_type_error: `${label} is not valid.` })
    .int(`${label} is not valid.`)
    .positive(`${label} is not valid.`)
    .max(2147483646, `${label} is not valid.`),
);

// Same password policy as parent sign-up: 8-72 bytes, upper, lower, number, special.
const strongPassword = z
  .string({ required_error: 'Password is required.', invalid_type_error: 'Password must be text.' })
  .superRefine((value, ctx) => {
    const issues = passwordIssues(value);
    if (issues.length) ctx.addIssue({ code: 'custom', message: `Password needs ${issues.join(', ')}.` });
  });

const email = z
  .string({ required_error: 'Email is required.', invalid_type_error: 'Email must be text.' })
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long.')
  .email('Enter a valid email address.')
  .refine((v) => !v.includes('..') && !v.split('@')[0].startsWith('.') && !v.split('@')[0].endsWith('.'),
    'Enter a valid email address.');

/**
 * A parent's Gmail — their login for the parent portal. Stored trimmed and
 * lowercased, so the same address typed two ways is the same account.
 */
const gmail = (label = 'Gmail address') => z
  .string({ required_error: `${label} is required.`, invalid_type_error: `${label} must be text.` })
  .transform(normalizeGmail)
  .superRefine((v, ctx) => {
    if (!v) return ctx.addIssue({ code: 'custom', message: `${label} is required.` });
    if (!isValidGmail(v)) ctx.addIssue({ code: 'custom', message: GMAIL_MESSAGE });
  });

const phPhone = z
  .string({ required_error: 'Contact number is required.', invalid_type_error: 'Contact number must be text.' })
  .trim()
  .regex(/^(09\d{9}|\+639\d{9})$/, CONTACT_MESSAGE);

const lrn = z
  .string({ invalid_type_error: 'LRN must be text.' })
  .trim()
  .regex(/^\d{12}$/, 'LRN should be exactly 12 digits.');

// YYYY-MM-DD, a real calendar date.
const isoDate = (label = 'Date') => z
  .string({ required_error: `${label} is required.`, invalid_type_error: `${label} must be a date.` })
  .trim()
  .date(`${label} is not a valid date.`);

const birthDate = z
  .string({ required_error: 'Birth date is required.', invalid_type_error: 'Birth date must be a date.' })
  .superRefine((v, ctx) => {
    const problem = birthDateIssue(v);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

const relationship = z.enum(RELATIONSHIPS, { errorMap: () => ({ message: 'Choose the guardian’s relationship to the student.' }) });

// Typed in when "Other" is chosen: "Neighbour", "Foster parent", ... Letters only.
const relationshipOther = optionalPersonName('Relationship');

/**
 * Adds the "Other needs a word of its own" rule to a schema that carries both
 * `relationship` and `relationshipOther`, and leaves `relationshipOther`
 * out when one of the five named relationships was chosen.
 */
function withRelationshipOther(schema) {
  return schema.superRefine((value, ctx) => {
    if (value.relationship === 'Other' && !value.relationshipOther) {
      ctx.addIssue({
        code: 'custom', path: ['relationshipOther'],
        message: 'Say how this person is related to the learner.',
      });
    }
  }).transform((value) => (value.relationship === 'Other'
    ? value
    : { ...value, relationshipOther: undefined }));
}

/**
 * The middle name and its "No middle name" tick. Leaving the box empty is only
 * allowed when the tick says there is no middle name, so a skipped field and a
 * learner who has none are two different records.
 */
function withMiddleName(schema, { field = 'middleName', noneField = 'noMiddleName', label = 'Middle name' } = {}) {
  return schema.superRefine((value, ctx) => {
    // Not every branch of a form carries this name (an already-enrolled
    // learner is chosen from the records, not typed in again).
    if (value[noneField] === undefined) return;
    const none = value[noneField] === true;
    const given = typeof value[field] === 'string' ? value[field].trim() : '';
    if (none && given) {
      ctx.addIssue({ code: 'custom', path: [field], message: `Untick “No middle name” to enter a ${label.toLowerCase()}.` });
    }
    if (!none && !given) {
      ctx.addIssue({ code: 'custom', path: [field], message: `${label} is required. Tick “No middle name” if there isn’t one.` });
    }
  });
}

module.exports = {
  personName, optionalPersonName, safeText, optionalSafeText, homeAddress, id, strongPassword,
  email, gmail, phPhone, lrn, isoDate, birthDate, relationship, relationshipOther,
  withRelationshipOther, withMiddleName, ADDRESS_MAX,
};
