const pool = require('./pool');

async function createStudent(db, { firstName, middleName, lastName, birthDate, sex }) {
  const result = await db.query(
    `INSERT INTO students (first_name, middle_name, last_name, birth_date, sex)
     VALUES ($1, $2, $3, pgp_sym_encrypt($4::text, $5), $6)
     RETURNING id`,
    [firstName, middleName || null, lastName, birthDate, process.env.ENCRYPTION_KEY, sex]
  );
  return result.rows[0].id;
}

module.exports = { createStudent };