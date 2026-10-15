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

async function findUserById(id) {
  const result = await pool.query(
    `SELECT u.id, u.email, u.password_hash, u.email_verified_at, r.name AS role_name,
            g.first_name, g.middle_name, g.last_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN guardians g ON g.user_id = u.id
     WHERE u.id = $1`,
    [id]
  );
  return result.rows[0];
}

async function updateUserPassword(userId, passwordHash) {
  await pool.query(
    `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
    [userId, passwordHash]
  );
}

module.exports = {
  findRoleIdByName, findUserByEmail, findUserById, createUser, updateUserPassword,
};