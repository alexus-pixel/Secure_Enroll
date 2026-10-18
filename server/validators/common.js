// Building blocks shared by the zod schemas, so every form in the system
// applies the same rules (and gives the same messages) for the same kind of
// value. The plain-function versions of these rules live in utils/validators.js.
const { z } = require('zod');
const {
  NAME_RE, SAFE_TEXT_RE, NAME_MAX, ADDRESS_MAX, RELATIONSHIPS, passwordIssues, birthDateIssue,
} = require('../utils/validators');

const NAME_MESSAGE = 'Use letters only (spaces, . \' - are fine).';

// A person's name: letters (including ñ, é ...), spaces, . ' -
const personName = (label = 'Name') => z
  .string({ required_error: `${label} is required.`, invalid_type_error: `${label} must be text.` })
  .trim()
  .min(1, `${label} is required.`)
  .max(NAME_MAX, `${label} is too long (up to ${NAME_MAX} characters).`)
  .regex(NAME_RE, `${label}: ${NAME_MESSAGE}`);

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

const phPhone = z
  .string({ required_error: 'Contact number is required.', invalid_type_error: 'Contact number must be text.' })
  .trim()
  .regex(/^(09\d{9}|\+63\d{10})$/, 'Contact number must be 11 digits starting with 09 (e.g. 09171234567) or 13 characters starting with +63 (e.g. +639171234567).');

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

module.exports = {
  personName, optionalPersonName, safeText, optionalSafeText, id, strongPassword, email, phPhone,
  lrn, isoDate, birthDate, relationship, ADDRESS_MAX,
};
