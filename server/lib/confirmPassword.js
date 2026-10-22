// "Type your password to confirm" for the few actions that are too sensitive
// to rest on a signed-in session alone, such as switching an account on or off.
//
// A session token proves someone signed in earlier; it does not prove the
// person at the keyboard now is the administrator (a computer left unlocked, a
// stolen token). Asking for the password again closes that gap.
//
// Wrong guesses are counted per administrator, so a hijacked session cannot be
// used to guess the password through this check: after MAX_FAILS wrong
// attempts it refuses for the rest of the window, even for the right password.
const bcrypt = require('bcryptjs');
const { findUserById } = require('../db/users');
const { PASSWORD_MAX_BYTES } = require('../utils/validators');
const { logAudit } = require('./audit');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const failures = new Map(); // userId -> { start, count }

function currentFailures(userId, now) {
  const f = failures.get(userId);
  if (!f || now - f.start > WINDOW_MS) { failures.delete(userId); return null; }
  return f;
}

/**
 * Checks req.body.password against the signed-in user's own password.
 * Returns true when it is right. Otherwise it has already sent the response
 * (400 missing, 401 wrong, 429 too many tries) and returns false, so the
 * caller just stops:
 *
 *   if (!(await confirmPassword(req, res, 'USER_DISABLED'))) return;
 */
async function confirmPassword(req, res, action) {
  const userId = String(req.user.id);
  const now = Date.now();
  const password = req.body && req.body.password;

  const f = currentFailures(userId, now);
  if (f && f.count >= MAX_FAILS) {
    const seconds = Math.max(1, Math.ceil((f.start + WINDOW_MS - now) / 1000));
    res.set('Retry-After', String(seconds));
    res.status(429).json({
      message: 'Too many incorrect passwords. Please wait a few minutes before trying again.',
      retryAfter: seconds,
    });
    return false;
  }

  if (typeof password !== 'string' || !password) {
    res.status(400).json({ message: 'Enter your password to confirm this action.', code: 'PASSWORD_REQUIRED' });
    return false;
  }

  const user = await findUserById(req.user.id);
  const ok = Boolean(user) && Buffer.byteLength(password) <= PASSWORD_MAX_BYTES
    && await bcrypt.compare(password, user.password_hash);

  if (!ok) {
    const entry = f || { start: now, count: 0 };
    entry.count += 1;
    failures.set(userId, entry);
    await logAudit(req.user.id, `${action}_PASSWORD_FAILED`, 'user', req.params.id ? Number(req.params.id) : null, req);
    res.status(401).json({ message: 'Incorrect password.', code: 'PASSWORD_INCORRECT' });
    return false;
  }

  failures.delete(userId);
  return true;
}

module.exports = { confirmPassword };
