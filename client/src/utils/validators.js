// Mirrors server/utils/validators.js -- the server repeats every rule, so these
// run only to show friendly messages next to the field. They run on blur and on
// submit, never as an alert() popup. (An alert fired from a blur handler steals
// focus back to the field it just left, which re-triggers the same blur check
// and reopens the alert: an infinite loop. Inline text next to the field can't
// do that, because it never takes focus.)

export const NAME_MIN = 2;
export const NAME_MAX = 50;
export const EMAIL_MAX = 254;
export const PASSWORD_MAX_BYTES = 72; // bcrypt ignores everything after 72 bytes
export const ADDRESS_MIN = 10;
export const ADDRESS_MAX = 150;
export const NOTE_MAX = 500;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// Only three file types are accepted, here and on the server
// (server/middleware/upload.js, which also checks the file's real bytes).
export const ALLOWED_FILE_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];
export const ALLOWED_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
// Put this on every <input type="file"> so the picker offers nothing else.
export const FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
export const FILE_TYPE_MESSAGE = 'Only PDF, JPG and PNG files are accepted.';

// Letters of any language (Niño, Peña, Réyes), spaces, . ' ’ and -
export const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A parent signs in with their own Gmail, so these fields take nothing else.
export const GMAIL_DOMAIN = '@gmail.com';
// What Google allows in front of the @: letters, digits and dots, starting and
// ending with a letter or digit, never two dots together, at most 30 long. A
// "+tag" alias is allowed and checked on the part before the +.
export const GMAIL_LOCAL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|\.(?!\.)){0,28}[A-Za-z0-9]$/;
// 09XXXXXXXXX (11 digits) or +639XXXXXXXXX (13 characters: "+" then digits only)
export const PH_MOBILE_RE = /^(09\d{9}|\+639\d{9})$/;
export const INITIAL_MAX = 2; // middle initial: "M" or "M."
export const CONTACT_MAX = 13;
export const LRN_RE = /^\d{12}$/;
// An address: letters, digits, spaces and the punctuation a Philippine address
// actually uses — , . # - /  as in "House/Blk/Lot, Street, Barangay, City"
export const ADDRESS_RE = /^[\p{L}\p{M}\d ,.#/-]+$/u;

export const RELATIONSHIPS = ['Mother', 'Father', 'Guardian', 'Grandparent', 'Other'];

export function validateName(value, {
  required = true, label = 'This field', max = NAME_MAX, min = NAME_MIN,
} = {}) {
  const v = (value || '').trim();
  if (!v) return required ? `${label} is required.` : '';
  if (v.length < min) return `${label} must be at least ${min} characters.`;
  if (v.length > max) return `${label} is too long (up to ${max} characters).`;
  if (/\d/.test(v)) return `${label} cannot contain numbers.`;
  if (!NAME_RE.test(v)) return `${label} should contain letters only (spaces, . ' - are fine).`;
  return '';
}

/** Trimmed and lowercased, which is how a Gmail address is stored. */
export function normalizeGmail(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * A parent's Gmail. Checks the shape Google itself allows, so a typed-in
 * address that could not belong to anybody is caught at the desk rather than
 * after a verification email silently goes nowhere.
 */
export function validateGmail(value, { label = 'Gmail address' } = {}) {
  const v = normalizeGmail(value);
  if (!v) return `${label} is required.`;
  if (v.length > EMAIL_MAX) return `${label} is too long.`;
  if ((v.match(/@/g) || []).length !== 1) return `Enter a valid ${label.toLowerCase()}.`;
  if (!v.endsWith(GMAIL_DOMAIN)) return `Enter a Gmail address ending in ${GMAIL_DOMAIN}.`;
  const local = v.slice(0, -GMAIL_DOMAIN.length).split('+')[0];
  if (!local) return `Enter a valid ${label.toLowerCase()}.`;
  if (local.length > 30) return 'A Gmail address has at most 30 characters before the @.';
  if (!GMAIL_LOCAL_RE.test(local)) {
    return 'Before the @, a Gmail address uses letters, numbers and dots only.';
  }
  return '';
}

export function validateConfirmGmail(email, confirm) {
  if (!String(confirm || '').trim()) return 'Please confirm the Gmail address.';
  if (normalizeGmail(email) !== normalizeGmail(confirm)) return 'The two Gmail addresses do not match.';
  return '';
}

export function validateEmail(value) {
  const v = (value || '').trim();
  if (!v) return 'Email address is required.';
  if (v.length > EMAIL_MAX) return 'Email address is too long.';
  if (!EMAIL_RE.test(v) || v.includes('..') || v.split('@')[0].startsWith('.') || v.split('@')[0].endsWith('.')) {
    return 'Enter a valid email address.';
  }
  return '';
}

// Keeps only what a phone number may contain while the person types:
// digits, plus a "+" as the very first character. Never more than 13 characters.
export function sanitizePhone(value) {
  const v = String(value || '');
  const plus = v.trimStart().startsWith('+') ? '+' : '';
  return (plus + v.replace(/\D/g, '')).slice(0, CONTACT_MAX);
}

export function validateContactNumber(value) {
  const v = (value || '').trim();
  if (!v) return 'Contact number is required.';
  if (v.startsWith('+')) {
    if (!/^\+63/.test(v)) return 'A number starting with + must start with +63.';
    if (!/^\+63\d*$/.test(v)) return 'After +63, use digits only.';
    if (!/^\+639/.test(v)) return 'A mobile number is +639 followed by 9 digits (e.g. +639171234567).';
    if (v.length !== 13) return 'With +63 the number must be 13 characters long (e.g. +639171234567).';
    return '';
  }
  if (!/^\d+$/.test(v)) return 'Use digits only (or start with +63).';
  if (!v.startsWith('09')) return 'Start the number with 09 (11 digits) or +63 (13 characters).';
  if (v.length !== 11) return 'With 09 the number must be exactly 11 digits (09xxxxxxxxx).';
  return '';
}

// Middle initial: optional, letters only, at most 2 characters.
export function validateInitial(value, { label = 'M.I.' } = {}) {
  return validateName(value, { required: false, label, max: INITIAL_MAX, min: 1 });
}

/**
 * A middle name. Optional only when the person has ticked "No middle name":
 * leaving it blank by accident is a different thing from saying there isn't
 * one, and the second is what the record should say.
 */
export function validateMiddleName(value, { none = false, label = 'Middle name' } = {}) {
  if (none) return '';
  const v = (value || '').trim();
  if (!v) return `${label} is required. Tick “No middle name” if there isn’t one.`;
  return validateName(v, { label });
}

/** A home address. */
export function validateAddress(value, { label = 'Address' } = {}) {
  const v = (value || '').trim().replace(/\s+/g, ' ');
  if (!v) return `${label} is required.`;
  if (v.length < ADDRESS_MIN) return `${label} is too short — give the house or block, street and barangay.`;
  if (v.length > ADDRESS_MAX) return `${label} is too long (up to ${ADDRESS_MAX} characters).`;
  if (!ADDRESS_RE.test(v)) return `${label} may use letters, numbers and , . # - / only.`;
  return '';
}

// Free text such as a home address: required, limited length, no < or >.
export function validateText(value, { required = true, label = 'This field', max = ADDRESS_MAX } = {}) {
  const v = (value || '').trim();
  if (!v) return required ? `${label} is required.` : '';
  if (v.length > max) return `${label} is too long (up to ${max} characters).`;
  if (/[<>]/.test(v)) return `${label} cannot contain < or > symbols.`;
  return '';
}

/** Keeps only digits while an LRN is being typed, never more than 12. */
export function sanitizeLrn(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 12);
}

// 12 digits. Pass { required: true } where the LRN must be given (Grade 1-6).
export function validateLrn(value, { required = false } = {}) {
  const v = (value || '').trim();
  if (!v) return required ? 'LRN is required for Grade 1 to Grade 6.' : '';
  if (!/^\d+$/.test(v)) return 'LRN should contain digits only.';
  if (!LRN_RE.test(v)) return 'LRN should be exactly 12 digits.';
  return '';
}

// A real calendar date that is not in the future. Age is not restricted.
export function validateBirthDate(value, today = new Date()) {
  const v = (value || '').trim();
  if (!v) return 'Birth date is required.';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return 'Enter the birth date as a valid date.';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    return 'That date does not exist. Please check the birth date.';
  }
  if (date > today) return 'The birth date cannot be in the future.';
  // No age limit: any past date is accepted for any grade level.
  return '';
}

// Date input limits for a birth date field. There is no lower limit, so the
// picker opens on a full list of years; the only impossible date is one in
// the future. How old the learner has to be is decided per grade level below.
export function birthDateBounds(today = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  return { max: fmt(today) };
}

/* ---------------------------------------------------------------------------
 * The birth date rule. There is no age limit: a learner may be any age for any
 * grade level. The date only has to be real and not in the future. Mirrors
 * server/lib/ageRules.js — change both together.
 * ------------------------------------------------------------------------- */
function parseIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/** Whole years between a birth date and a reference date — for display only. */
export function ageOn(birthDate, referenceDate) {
  const birth = parseIsoDate(birthDate);
  const ref = referenceDate instanceof Date ? referenceDate : parseIsoDate(referenceDate);
  if (!birth || !ref) return null;
  let age = ref.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday = ref.getUTCMonth() < birth.getUTCMonth()
    || (ref.getUTCMonth() === birth.getUTCMonth() && ref.getUTCDate() < birth.getUTCDate());
  return beforeBirthday ? age - 1 : age;
}

/* ---------------------------------------------------------------------------
 * How young is too young for a grade level.
 *
 * There is no upper limit — a learner may be any age above the minimum, and
 * adults finishing elementary school are welcome. There is a lower one: a
 * four-year-old cannot be put into Grade 1, and a learner years younger than
 * their grade is a mistyped birth date far more often than a prodigy. The
 * minimum is a year below the usual entry age, so a child who turns the usual
 * age during the school year still fits. Mirrors server/lib/ageRules.js —
 * change both together.
 * ------------------------------------------------------------------------- */
const MIN_AGE_BY_SORT_ORDER = [4, 5, 6, 7, 8, 9, 10];
export function minAgeForGrade(sortOrder) {
  const i = Number(sortOrder);
  if (!Number.isFinite(i) || i < 0) return 0;
  return i < MIN_AGE_BY_SORT_ORDER.length
    ? MIN_AGE_BY_SORT_ORDER[i]
    : MIN_AGE_BY_SORT_ORDER[MIN_AGE_BY_SORT_ORDER.length - 1] + (i - MIN_AGE_BY_SORT_ORDER.length + 1);
}

/**
 * The birth date, plus "is this learner old enough for this grade level".
 * `grade` is { sortOrder, name }; without one, only the date itself is checked.
 * `yearStartsOn` is the first day of classes, because that is when the age
 * that matters is counted.
 */
export function validateBirthDateForGrade(value, grade = null, yearStartsOn = null) {
  const basic = validateBirthDate(value);
  if (basic) return basic;
  if (!grade || grade.sortOrder === undefined || grade.sortOrder === null) return '';

  const reference = parseIsoDate(yearStartsOn) || new Date();
  const age = ageOn(value, reference);
  const minimum = minAgeForGrade(grade.sortOrder);
  if (age === null || age >= minimum) return '';

  const name = grade.name || 'that grade level';
  return `A learner has to be at least ${minimum} years old to enter ${name}, and this birth date makes `
    + `them ${age === 1 ? '1 year' : `${age} years`} old when classes start. Check the birth date, `
    + 'or choose a lower grade level.';
}

export function validateFile(file, { label = 'This file' } = {}) {
  if (!file) return '';
  const name = String(file.name || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot) : '';
  const type = String(file.type || '').toLowerCase().split(';')[0].trim();
  if (!ALLOWED_FILE_EXTENSIONS.includes(ext)) return `${label}: ${FILE_TYPE_MESSAGE}`;
  // An empty type happens on some phones; the extension is enough there, and
  // the server checks the real bytes either way.
  if (type && !ALLOWED_FILE_TYPES.includes(type)) return `${label}: ${FILE_TYPE_MESSAGE}`;
  if (file.size > MAX_UPLOAD_BYTES) return `${label} is larger than 5 MB.`;
  if (file.size === 0) return `${label} is empty.`;
  return '';
}

// Used to render a live checklist (see PasswordInput's `rules` prop).
export function passwordRules(value) {
  const v = value || '';
  return [
    { met: v.length >= 8, label: 'At least 8 characters' },
    { met: /[A-Z]/.test(v), label: 'One uppercase letter' },
    { met: /[a-z]/.test(v), label: 'One lowercase letter' },
    { met: /[0-9]/.test(v), label: 'One number' },
    { met: /[^A-Za-z0-9]/.test(v), label: 'One special character' },
  ];
}

export function validatePassword(value) {
  const v = value || '';
  if (new TextEncoder().encode(v).length > PASSWORD_MAX_BYTES) {
    return `Password is too long (up to ${PASSWORD_MAX_BYTES} characters).`;
  }
  const unmet = passwordRules(v).filter((r) => !r.met);
  return unmet.length ? `Password needs ${unmet.map((r) => r.label.toLowerCase()).join(', ')}.` : '';
}

export function validateConfirmPassword(password, confirm) {
  if (!confirm) return 'Please confirm your password.';
  if (password !== confirm) return 'Passwords do not match.';
  return '';
}
