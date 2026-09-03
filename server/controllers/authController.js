const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { findRoleIdByName, findUserByEmail, createUser } = require('../db/users');
const pool = require('../db/pool');

async function logAudit(userId, action, req) {
  await pool.query(
    `INSERT INTO audit_logs (user_id, action, ip_address, user_agent)
     VALUES ($1, $2, $3, $4)`,
    [userId, action, req.ip, req.get('user-agent')]
  );
}

async function register(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }

    const existing = await findUserByEmail(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ message: 'An account with that email already exists.' });
    }

    const roleId = await findRoleIdByName('parent'); // public sign-up is always a parent
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await createUser({ email: email.toLowerCase(), passwordHash, roleId });

    await logAudit(user.id, 'REGISTER', req);
    res.status(201).json({ id: user.id, email: user.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Registration failed.' });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    const user = await findUserByEmail((email || '').toLowerCase());

    // Same error whether the email doesn't exist or the password is wrong —
    // don't tell an attacker which one they got right.
    const genericError = () => res.status(401).json({ message: 'Invalid email or password.' });

    if (!user) return genericError();

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(423).json({ message: 'Account temporarily locked. Try again later.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      await pool.query(
        `UPDATE users SET failed_login_attempts = failed_login_attempts + 1,
         locked_until = CASE WHEN failed_login_attempts + 1 >= 5
                              THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END
         WHERE id = $1`,
        [user.id]
      );
      await logAudit(user.id, 'LOGIN_FAILED', req);
      return genericError();
    }

    if (!user.is_active) {
      return res.status(403).json({ message: 'This account has been disabled.' });
    }

    await pool.query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL,
       last_login_at = NOW() WHERE id = $1`,
      [user.id]
    );

    const token = jwt.sign(
      { sub: user.id, role: user.role_name },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    await logAudit(user.id, 'LOGIN_SUCCESS', req);
    res.json({ token, user: { id: user.id, email: user.email, role: user.role_name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Login failed.' });
  }
}

module.exports = { register, login };