// Server-side validation. The client validates too, for a responsive UI,
// but that check can always be bypassed by anyone calling the API directly
// (curl, Postman, a modified frontend) — so every rule here is enforced
// again, independently, before anything touches the database.

const NAME_RE = /^[A-Za-z .'-]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PH_MOBILE_RE = /^09\d{9}$/; // 11 digits, Philippine mobile format: 09XXXXXXXXX

function isValidEmail(value) {
  return typeof value === 'string' && EMAIL_RE.test(value.trim());
}

function isValidName(value, { required = true } = {}) {
  if (!value || !value.trim()) return !required;
  return NAME_RE.test(value.trim());
}

function isValidContactNumber(value) {
  return typeof value === 'string' && PH_MOBILE_RE.test(value.trim());
}

// Returns an array of unmet requirements; empty array means the password is fine.
function passwordIssues(password) {
  const issues = [];
  if (!password || password.length < 8) issues.push('at least 8 characters');
  if (!/[A-Z]/.test(password || '')) issues.push('one uppercase letter');
  if (!/[a-z]/.test(password || '')) issues.push('one lowercase letter');
  if (!/[0-9]/.test(password || '')) issues.push('one number');
  if (!/[^A-Za-z0-9]/.test(password || '')) issues.push('one special character');
  return issues;
}

module.exports = { isValidEmail, isValidName, isValidContactNumber, passwordIssues };
