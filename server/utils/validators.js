// Server-side validation. The client validates too, for a responsive UI,
// but that check can always be bypassed by anyone calling the API directly
// (curl, Postman, a modified frontend) -- so every rule here is enforced
// again, independently, before anything touches the database.
//
// Every function here accepts ANY value (not only strings), so a request
// such as {"firstName": {"a": 1}} is refused with a normal 400 message
// instead of crashing the handler with a 500.

const NAME_MIN = 2;            // "Jo" is a name; a single stray letter is a slip
const NAME_MAX = 50;           // the column is VARCHAR(60), so this fits with room to spare
const INITIAL_MAX = 2;         // middle initial: "M" or "M."
const EMAIL_MAX = 254;
const PASSWORD_MAX_BYTES = 72; // bcrypt silently ignores everything after 72 bytes
const ADDRESS_MIN = 10;
const ADDRESS_MAX = 150;
const NOTE_MAX = 500;
const REMARK_MAX = 1000;

// Letters of any language (so Niño, Peña, José are fine), then spaces,
// dots, apostrophes and hyphens. It must start with a letter, so "...",
// "-" or "'" alone are not names. Digits, < > and other symbols are refused.
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
// Two accepted formats: 09XXXXXXXXX (11 digits) or +639XXXXXXXXX (13 characters, "+" then digits only).
const PH_MOBILE_RE = /^(09\d{9}|\+639\d{9})$/;
const CONTACT_MESSAGE = 'Contact number must be 11 digits starting with 09 (e.g. 09171234567) or 13 characters starting with +639 (e.g. +639171234567).';
const LRN_RE = /^\d{12}$/;
// Free text such as a room name: no angle brackets and no control characters.
const SAFE_TEXT_RE = /^[^<>\u0000-\u001F\u007F]+$/u;
// A home address: letters, digits, spaces and , . # - / only.
const ADDRESS_RE = /^[\p{L}\p{M}\d ,.#/-]+$/u;
const ADDRESS_MESSAGE = `Address may use letters, numbers and , . # - / only, and must be ${ADDRESS_MIN} to ${ADDRESS_MAX} characters.`;

// A parent's login is their own Gmail, so nothing else is accepted in the
// fields that become one. Staff accounts are not restricted this way.
const GMAIL_DOMAIN = '@gmail.com';
const GMAIL_LOCAL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|\.(?!\.)){0,28}[A-Za-z0-9]$/;
const GMAIL_MESSAGE = 'Enter a Gmail address ending in @gmail.com.';

const SEXES = ['M', 'F'];
const RELATIONSHIPS = ['Mother', 'Father', 'Guardian', 'Grandparent', 'Other'];

const isString = (v) => typeof v === 'string';

function isValidEmail(value) {
  if (!isString(value)) return false;
  const v = value.trim();
  if (!v || v.length > EMAIL_MAX || !EMAIL_RE.test(v)) return false;
  const [local] = v.split('@');
  return local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !v.includes('..');
}

function isValidName(value, { required = true, max = NAME_MAX, min = NAME_MIN } = {}) {
  if (value === undefined || value === null || value === '') return !required;
  if (!isString(value)) return false;
  const v = value.trim();
  if (!v) return !required;
  return v.length >= min && v.length <= max && NAME_RE.test(v);
}

/** Normalised the way a Gmail address is stored: trimmed and lowercased. */
function normalizeGmail(value) {
  return String(value === undefined || value === null ? '' : value).trim().toLowerCase();
}

/** The shape Google itself allows in front of @gmail.com. */
function isValidGmail(value) {
  if (!isString(value)) return false;
  const v = normalizeGmail(value);
  if (!v || v.length > EMAIL_MAX) return false;
  if ((v.match(/@/g) || []).length !== 1) return false;
  if (!v.endsWith(GMAIL_DOMAIN)) return false;
  const local = v.slice(0, -GMAIL_DOMAIN.length).split('+')[0];
  return Boolean(local) && local.length <= 30 && GMAIL_LOCAL_RE.test(local);
}

/** A home address. Returns '' when it is fine, or the sentence to show. */
function addressIssue(value, { label = 'Address' } = {}) {
  if (!isString(value)) return `${label} is required.`;
  const v = value.trim().replace(/\s+/g, ' ');
  if (!v) return `${label} is required.`;
  if (v.length < ADDRESS_MIN) return `${label} is too short — give the house or block, street and barangay.`;
  if (v.length > ADDRESS_MAX) return `${label} is too long (up to ${ADDRESS_MAX} characters).`;
  if (!ADDRESS_RE.test(v)) return `${label} may use letters, numbers and , . # - / only.`;
  return '';
}

function isValidAddress(value) {
  return addressIssue(value) === '';
}

function isValidContactNumber(value) {
  return isString(value) && PH_MOBILE_RE.test(value.trim());
}

// +639171234567 and 09171234567 are the same phone: compare people by this form.
function canonicalPhone(value) {
  const v = String(value || '').trim();
  return v.startsWith('+63') ? `0${v.slice(3)}` : v;
}

function isValidLrn(value) {
  return isString(value) && LRN_RE.test(value.trim());
}

function isValidSex(value) {
  return isString(value) && SEXES.includes(value);
}

function isValidRelationship(value) {
  return isString(value) && RELATIONSHIPS.includes(value);
}

// Address, ID type, room and similar free text.
function isValidText(value, { required = true, max = ADDRESS_MAX } = {}) {
  if (value === undefined || value === null || value === '') return !required;
  if (!isString(value)) return false;
  const v = value.trim();
  if (!v) return !required;
  return v.length <= max && SAFE_TEXT_RE.test(v);
}

// Returns an array of unmet requirements; empty array means the password is fine.
function passwordIssues(password) {
  if (!isString(password)) return ['a password'];
  const issues = [];
  if (password.length < 8) issues.push('at least 8 characters');
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) issues.push(`no more than ${PASSWORD_MAX_BYTES} characters`);
  if (!/[A-Z]/.test(password)) issues.push('one uppercase letter');
  if (!/[a-z]/.test(password)) issues.push('one lowercase letter');
  if (!/[0-9]/.test(password)) issues.push('one number');
  if (!/[^A-Za-z0-9]/.test(password)) issues.push('one special character');
  return issues;
}

// Birth date: a real calendar date written YYYY-MM-DD, not in the future,
// and an age that makes sense for an elementary school (3 to 18 years).
// Returns an error message, or '' when the date is fine.
function birthDateIssue(value, today = new Date()) {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return 'Enter the birth date as a real date (YYYY-MM-DD).';
  }
  const [y, m, d] = value.trim().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return 'That date does not exist. Please check the birth date.';
  }
  const now = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  if (dt > now) return 'The birth date cannot be in the future.';
  // No age limit: the school decides who it admits, and an over-age or
  // under-age learner is a conversation at the desk, not a blocked form.
  return '';
}

// Whole-number id from a JSON body (accepts 12 or "12", refuses "12abc", 1.5, -1, null).
function toId(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 2147483647) return value;
  if (isString(value) && /^\d{1,9}$/.test(value.trim()) && Number(value) > 0) return Number(value);
  return null;
}

module.exports = {
  NAME_MIN, NAME_MAX, INITIAL_MAX, EMAIL_MAX, PASSWORD_MAX_BYTES,
  ADDRESS_MIN, ADDRESS_MAX, NOTE_MAX, REMARK_MAX,
  NAME_RE, SAFE_TEXT_RE, ADDRESS_RE, ADDRESS_MESSAGE, SEXES, RELATIONSHIPS,
  GMAIL_DOMAIN, GMAIL_MESSAGE, normalizeGmail, isValidGmail,
  isValidEmail, isValidName, isValidContactNumber, isValidLrn, isValidSex, isValidRelationship,
  isValidText, isValidAddress, addressIssue,
  passwordIssues, birthDateIssue, toId, canonicalPhone, CONTACT_MESSAGE,
};
