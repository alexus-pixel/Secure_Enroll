const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

// Reads the JWT from the Authorization header, verifies it, and
// attaches the logged-in user's id and role to req.user.
async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided.' });
  }
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
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