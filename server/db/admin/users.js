const pool = require('../pool');

/**
 * Status here is derived, not stored: "locked" is a live check
 * against locked_until (the same column authController.js already
 * writes to on failed logins), not a separate flag that could go
 * stale. "disabled" is is_active = false. Everything else is
 * "active". This means the Users table always reflects the same
 * lockout state the login endpoint is actually enforcing.
 */
function buildUserFilters({ search, role, status, lastLoginFrom, lastLoginTo }) {
  const clauses = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(u.email ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`);
  }
  if (role) {
    params.push(role);
    clauses.push(`r.name = $${params.length}`);
  }
  if (status === 'locked') {
    clauses.push(`u.locked_until IS NOT NULL AND u.locked_until > NOW()`);
  } else if (status === 'disabled') {
    clauses.push(`u.is_active = FALSE`);
  } else if (status === 'active') {
    clauses.push(`u.is_active = TRUE AND (u.locked_until IS NULL OR u.locked_until <= NOW())`);
  }
  if (lastLoginFrom) {
    params.push(lastLoginFrom);
    clauses.push(`u.last_login_at >= $${params.length}`);
  }
  if (lastLoginTo) {
    params.push(lastLoginTo);
    clauses.push(`u.last_login_at <= $${params.length}`);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

async function listUsers(filters) {
  const { where, params } = buildUserFilters(filters);
  const page = filters.page || 1;
  const limit = filters.limit || 25;
  const offset = (page - 1) * limit;

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM users u JOIN roles r ON r.id = u.role_id
     ${where}`,
    params
  );

  const rowsResult = await pool.query(
    `SELECT u.id, u.email, u.full_name, r.name AS role, u.role_id, u.is_active, u.last_login_at,
            CASE WHEN u.locked_until IS NOT NULL AND u.locked_until > NOW() THEN TRUE ELSE FALSE END AS is_locked,
            u.created_at
     FROM users u JOIN roles r ON r.id = u.role_id
     ${where}
     ORDER BY u.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return { users: rowsResult.rows, total: countResult.rows[0].total, page, limit };
}

async function getUserCounts() {
  const result = await pool.query(
    `SELECT r.name AS role, COUNT(*)::int AS count
     FROM users u JOIN roles r ON r.id = u.role_id
     GROUP BY r.name`
  );
  const counts = { total: 0, parent: 0, registrar: 0, admin: 0 };
  for (const row of result.rows) {
    counts[row.role] = row.count;
    counts.total += row.count;
  }
  return counts;
}

async function getRoles() {
  const result = await pool.query('SELECT id, name, description FROM roles ORDER BY id');
  return result.rows;
}

async function findUserById(id) {
  const result = await pool.query(
    `SELECT u.id, u.email, u.role_id, r.name AS role, u.is_active
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function findUserByEmail(email) {
  const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  return result.rows[0] || null;
}

async function createStaffUser({ email, fullName, passwordHash, roleId }) {
  const result = await pool.query(
    `INSERT INTO users (email, full_name, password_hash, role_id, is_active)
     VALUES ($1, $2, $3, $4, TRUE)
     RETURNING id, email, full_name, role_id, is_active, created_at`,
    [email, fullName || null, passwordHash, roleId]
  );
  return result.rows[0];
}

async function updateUserRole(id, roleId) {
  const result = await pool.query(
    `UPDATE users SET role_id = $2, updated_at = NOW() WHERE id = $1
     RETURNING id, email, role_id`,
    [id, roleId]
  );
  return result.rows[0] || null;
}

async function setUserActive(id, isActive) {
  const result = await pool.query(
    `UPDATE users SET is_active = $2, updated_at = NOW() WHERE id = $1
     RETURNING id, email, is_active`,
    [id, isActive]
  );
  return result.rows[0] || null;
}

async function resetPassword(id, passwordHash) {
  // Resetting a password is also a reasonable moment to clear any
  // existing lockout — an admin resetting a locked-out user's
  // password is clearly trying to get them back in, not leave
  // them locked out with a new password they still can't use.
  const result = await pool.query(
    `UPDATE users SET password_hash = $2, failed_login_attempts = 0,
     locked_until = NULL, updated_at = NOW() WHERE id = $1
     RETURNING id, email`,
    [id, passwordHash]
  );
  return result.rows[0] || null;
}

module.exports = {
  listUsers, getUserCounts, getRoles, findUserById, findUserByEmail,
  createStaffUser, updateUserRole, setUserActive, resetPassword,
};
