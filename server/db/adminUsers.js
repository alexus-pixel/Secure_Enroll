const pool = require('./pool');
const bcrypt = require('bcryptjs');

// ASSUMPTION: users columns are id, email, password_hash, full_name,
// role_id, is_active, created_at, and there's a roles table with id, name.
// Check against schema.sql — if you store first_name/last_name separately
// instead of full_name, adjust the SELECT/INSERT lists below.

async function getAllUsers({ role, search, page = 1, limit = 25 } = {}) {
  const conditions = [];
  const values = [];
  let i = 1;

  if (role) {
    conditions.push(`r.name = $${i++}`);
    values.push(role);
  }
  if (search) {
    conditions.push(`(u.email ILIKE $${i} OR u.full_name ILIKE $${i})`);
    values.push(`%${search}%`);
    i++;
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const query = `
    SELECT u.id, u.email, u.full_name, r.id AS role_id, r.name AS role, u.is_active, u.created_at
    FROM users u
    JOIN roles r ON r.id = u.role_id
    ${whereClause}
    ORDER BY u.created_at DESC
    LIMIT $${i++} OFFSET $${i++}
  `;
  const queryValues = [...values, limit, offset];

  const countQuery = `SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id ${whereClause}`;

  const [rows, count] = await Promise.all([
    pool.query(query, queryValues),
    pool.query(countQuery, values),
  ]);

  return { users: rows.rows, total: parseInt(count.rows[0].count, 10), page, limit };
}

async function getRoles() {
  const { rows } = await pool.query(`SELECT id, name FROM roles ORDER BY name`);
  return rows;
}

// Parents self-register through the public register endpoint your team
// already built — this is specifically for admins creating registrar/admin
// staff accounts from the admin panel.
async function createStaffUser({ email, password, fullName, roleId }) {
  const passwordHash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role_id, is_active, created_at)
     VALUES ($1, $2, $3, $4, true, NOW())
     RETURNING id, email, full_name, role_id, is_active, created_at`,
    [email, passwordHash, fullName, roleId]
  );
  return rows[0];
}

async function updateUserRole(userId, roleId) {
  const { rows } = await pool.query(
    `UPDATE users SET role_id = $2 WHERE id = $1 RETURNING id, email, role_id`,
    [userId, roleId]
  );
  return rows[0];
}

async function setUserActive(userId, isActive) {
  const { rows } = await pool.query(
    `UPDATE users SET is_active = $2 WHERE id = $1 RETURNING id, email, is_active`,
    [userId, isActive]
  );
  return rows[0];
}

module.exports = { getAllUsers, getRoles, createStaffUser, updateUserRole, setUserActive };
