// Mirrors server/utils/validators.js -- the server repeats every rule, so these
// run only to show friendly messages next to the field. They run on blur and on
// submit, never as an alert() popup. (An alert fired from a blur handler steals
// focus back to the field it just left, which re-triggers the same blur check
// and reopens the alert: an infinite loop. Inline text next to the field can't
// do that, because it never takes focus.)

export const NAME_MAX = 60;
export const EMAIL_MAX = 254;
export const PASSWORD_MAX_BYTES = 72; // bcrypt ignores everything after 72 bytes
export const ADDRESS_MAX = 255;
export const NOTE_MAX = 500;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
// Any file type is accepted except audio and video.
const MEDIA_EXTENSIONS = /\.(mp3|wav|wma|aac|flac|ogg|oga|opus|m4a|m4b|mid|midi|aif|aiff|amr|weba|mp4|m4v|mov|avi|mkv|webm|wmv|flv|f4v|mpg|mpeg|mpe|3gp|3g2|ogv|mts|m2ts|vob)$/i;

// Letters of any language (Niño, Peña, Réyes), spaces, . ' ’ and -
export const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 09XXXXXXXXX (11 digits) or +63XXXXXXXXXX (13 characters: "+" then digits only)
export const PH_MOBILE_RE = /^(09\d{9}|\+63\d{10})$/;
export const INITIAL_MAX = 2; // middle initial: "M" or "M."
export const CONTACT_MAX = 13;
export const LRN_RE = /^\d{12}$/;

export const RELATIONSHIPS = [
  'Mother', 'Father', 'Guardian', 'Grandmother', 'Grandfather', 'Aunt', 'Uncle', 'Sibling', 'Other',
];

export function validateName(value, { required = true, label = 'This field', max = NAME_MAX } = {}) {
  const v = (value || '').trim();
  if (!v) return required ? `${label} is required.` : '';
  if (v.length > max) return `${label} is too long (up to ${max} characters).`;
  if (!NAME_RE.test(v)) return `${label} should contain letters only.`;
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
    if (v.length !== 13) return 'With +63 the number must be 13 characters long (e.g. +639171234567).';
    return '';
  }
  if (!/^\d+$/.test(v)) return 'Use digits only (or start with +63).';
  if (!v.startsWith('09')) return 'Start the number with 09 (11 digits) or +63 (13 characters).';
  if (v.length !== 11) return 'With 09 the number must be exactly 11 digits (e.g. 09171234567).';
  return '';
}

// Middle initial: optional, letters only, at most 2 characters.
export function validateInitial(value, { label = 'M.I.' } = {}) {
  return validateName(value, { required: false, label, max: INITIAL_MAX });
}

// Free text such as a home address: required, limited length, no < or >.
export function validateText(value, { required = true, label = 'This field', max = ADDRESS_MAX } = {}) {
  const v = (value || '').trim();
  if (!v) return required ? `${label} is required.` : '';
  if (v.length > max) return `${label} is too long (up to ${max} characters).`;
  if (/[<>]/.test(v)) return `${label} cannot contain < or > symbols.`;
  return '';
}

// 12 digits. Pass { required: true } where the LRN must be given (Grade 1-6).
export function validateLrn(value, { required = false } = {}) {
  const v = (value || '').trim();
  if (!v) return required ? 'LRN is required for Grade 1 to Grade 6.' : '';
  if (!/^\d+$/.test(v)) return 'LRN should contain digits only.';
  if (!LRN_RE.test(v)) return 'LRN should be exactly 12 digits.';
  return '';
}

// A school-age learner: a real date, not in the future, aged 3 to 18.
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
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age -= 1;
  if (age < 3) return 'The learner must be at least 3 years old.';
  if (age > 18) return 'The learner must be 18 years old or younger.';
  return '';
}

// Date input limits for a birth date field (min = 18 years back, max = today).
export function birthDateBounds(today = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const min = new Date(today.getFullYear() - 19, today.getMonth(), today.getDate() + 1);
  return { min: fmt(min), max: fmt(today) };
}

// One uploaded document: any file type except audio and video, up to 5 MB.
export function validateFile(file, { label = 'This file' } = {}) {
  if (!file) return '';
  if (/^(audio|video)\//i.test(file.type || '') || MEDIA_EXTENSIONS.test(file.name || '')) {
    return `${label} cannot be an audio or video file. Please choose a document or an image.`;
  }
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
