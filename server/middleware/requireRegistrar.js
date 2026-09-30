const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

module.exports = async function requireRegistrar(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ message: 'Not authenticated.' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const userId = payload.id ?? payload.userId ?? payload.sub;

    const { rows } = await pool.query(
      `SELECT u.id, u.email, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.is_active`,
      [userId]
    );
    if (!rows[0] || rows[0].role !== 'registrar') {
      return res.status(403).json({ message: 'Registrar access only.' });
    }
    req.user = rows[0];
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token.' });
  }
};