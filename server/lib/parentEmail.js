const { checkEmailAcceptable } = require('./emailGate');

/**
 * Is this address one a parent can actually be reached at?
 *
 * A parent account created at the front desk is the parent's login, and
 * everything the school later tells them — the application's status, a missing
 * requirement, a password reset — goes to this address. A mistyped one creates
 * an account nobody can open, which is what this is here to prevent.
 *
 * The checks themselves live in lib/emailGate.js, which every email field in
 * the system goes through — a parent's, a guardian's, a teacher's, a staff
 * account's — so there is one answer to "is this address usable" rather than a
 * different one per form. This name stays because the parent-facing callers
 * read better for it, and because it fixes the one thing that is particular to
 * them: a parent is asked for a Gmail address.
 */
async function checkParentEmail(email) {
  return checkEmailAcceptable(email, { requireGmail: true });
}

module.exports = { checkParentEmail };
