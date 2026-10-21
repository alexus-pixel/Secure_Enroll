const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

// The only requests an account with a temporary password may still make.
// req.path is the path inside the router this middleware runs in, so both the
// mounted and the full path are checked.
const PASSWORD_CHANGE_PATHS = ['/me/password', '/api/auth/me/password', '/me', '/api/auth/me', '/logout', '/api/auth/logout'];
const PASSWORD_CHANGE_ALLOWED = (req) =>
  PASSWORD_CHANGE_PATHS.includes(req.path) || PASSWORD_CHANGE_PATHS.includes(req.originalUrl.split('?')[0]);

// Reads the JWT from the Authorization header, verifies it, and
// attaches the logged-in user's id and role to req.user.
async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided.' });
  }
  const token = header.split(' ')[1];
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }

  // A signed token alone is not enough. A login token lasts 8 hours, so the
  // account is checked in the database on every request: if an administrator
  // disables the account or changes its role, the change takes effect at once
  // instead of waiting for the token to expire. The role also comes from the
  // database, never from the role written inside the token.
  try {
    const result = await pool.query(
      `SELECT u.is_active, u.must_change_password, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1`,
      [payload.sub]
    );
    const row = result.rows[0];
    if (!row) {
      return res.status(401).json({ message: 'Your session is no longer valid. Please sign in again.' });
    }
    // An administrator switched the account off while its owner was still
    // signed in. The token is valid for another few hours, so without this the
    // session would quietly keep working; the same marker the sign-in page
    // uses goes out here too, so the browser can say what happened instead of
    // showing a bare 401. Read from is_active each time, never from a flag, so
    // it behaves identically however often the account is switched off.
    if (!row.is_active) {
      return res.status(401).json({
        code: 'ACCOUNT_DEACTIVATED',
        reason: 'account_deactivated',
        message: 'Your account was deactivated by the administrator.',
      });
    }
    // An account an administrator created still has its temporary password.
    // Until it has been replaced, the only things it can do are read its own
    // account and set a new password. Everything else is refused here, so the
    // rule does not depend on the browser following it.
    if (row.must_change_password && !PASSWORD_CHANGE_ALLOWED(req)) {
      return res.status(403).json({
        message: 'Please choose your own password before continuing.',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }
    req.user = { id: payload.sub, role: row.role, mustChangePassword: Boolean(row.must_change_password) };
    next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not confirm your account status.' });
  }
}

// Confirms the user's role actually holds the named permission by
// asking the database, rather than trusting the JWT's role claim alone.
function requirePermission(permissionCode) {
  return async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT 1 FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE r.name = $1 AND p.code = $2`,
        [req.user.role, permissionCode]
      );
      if (result.rows.length === 0) {
        return res.status(403).json({ message: 'You do not have permission to do this.' });
      }
      next();
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Permission check failed.' });
    }
  };
}

// Gate for actions that shouldn't happen until the account's email is
// confirmed (e.g. submitting a child's documents). Checked fresh against
// the database rather than trusting a claim baked into the JWT at login
// time, so verifying mid-session takes effect immediately rather than
// waiting for the token to expire and be reissued.
async function requireVerifiedEmail(req, res, next) {
  try {
    const result = await pool.query('SELECT email_verified_at FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows[0]?.email_verified_at) {
      return res.status(403).json({ message: 'Please verify your email address first.' });
    }
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not confirm your account status.' });
  }
}

module.exports = { authenticate, requirePermission, requireVerifiedEmail };