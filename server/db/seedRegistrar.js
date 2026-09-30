require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');
const { findRoleIdByName, createUser } = require('./users');

async function main() {
  const email = 'registrar@test.com';
  const password = 'ChangeMe123!'; // change this before running

  const roleId = await findRoleIdByName('registrar');
  if (!roleId) throw new Error('Role not found. Run schema.sql first.');

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await createUser({ email, passwordHash, roleId });
  console.log('Registrar created:', user);
}

main()
  .catch((err) => console.error('Failed:', err.message))
  .finally(() => pool.end());