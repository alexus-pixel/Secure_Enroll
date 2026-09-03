const pool = require('./pool');

async function findRoleIdByName(roleName) {
  const result = await pool.query('SELECT id FROM roles WHERE name = $1', [roleName]);
  return result.rows[0]?.id;
}

async function findUserByEmail(email) {
  const result = await pool.query(
    `SELECT u.id, u.email, u.password_hash, u.is_active,
            u.failed_login_attempts, u.locked_until,
            r.name AS role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.email = $1`,
    [email]
  );
  return result.rows[0];
}

async function createUser({ email, passwordHash, roleId }) {
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, role_id)
     VALUES ($1, $2, $3)
     RETURNING id, email, role_id`,
    [email, passwordHash, roleId]
  );
  return result.rows[0];
}

module.exports = { findRoleIdByName, findUserByEmail, createUser };