const bcrypt = require('bcryptjs');
const pool = require('./db/pool');

const EMAIL = 'registrar@test.com';
const PASSWORD = 'Registrar123!';

(async () => {
  const hash = await bcrypt.hash(PASSWORD, 12);
  const r = await pool.query(
    `UPDATE users
     SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL
     WHERE email = $2
     RETURNING id, email, role_id`,
    [hash, EMAIL]
  );
  console.log(r.rows.length ? r.rows : 'No user with that email');
  process.exit();
})();