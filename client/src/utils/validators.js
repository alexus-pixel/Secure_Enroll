// Mirrors server/utils/validators.js. These run on blur to show inline
// messages next to the field — never as an alert() popup. (An alert fired
// from a blur handler steals focus back to the field it just left, which
// re-triggers the same blur check and reopens the alert: an infinite loop.
// Inline text next to the field can't do that, because it never takes focus.)

export const NAME_RE = /^[A-Za-z .'-]+$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PH_MOBILE_RE = /^09\d{9}$/; // 11 digits: 09XXXXXXXXX

export function validateName(value, { required = true, label = 'This field' } = {}) {
  const v = (value || '').trim();
  if (!v) return required ? `${label} is required.` : '';
  if (!NAME_RE.test(v)) return `${label} should contain letters only.`;
  return '';
}

export function validateEmail(value) {
  const v = (value || '').trim();
  if (!v) return 'Email address is required.';
  if (!EMAIL_RE.test(v)) return 'Enter a valid email address.';
  return '';
}

export function validateContactNumber(value) {
  const v = (value || '').trim();
  if (!v) return 'Contact number is required.';
  if (!/^\d+$/.test(v)) return 'Contact number should be digits only.';
  if (!PH_MOBILE_RE.test(v)) return 'Enter an 11-digit mobile number starting with 09.';
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
  const unmet = passwordRules(value).filter((r) => !r.met);
  return unmet.length ? `Password needs ${unmet.map((r) => r.label.toLowerCase()).join(', ')}.` : '';
}

export function validateConfirmPassword(password, confirm) {
  if (!confirm) return 'Please confirm your password.';
  if (password !== confirm) return 'Passwords do not match.';
  return '';
}
