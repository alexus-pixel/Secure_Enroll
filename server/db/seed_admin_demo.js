/**
 * SecureEnroll — dev-only demo data for the admin section.
 *
 * NOT for production. Run only against a local/dev database,
 * after schema.sql and migrations/002_admin.sql have both been
 * applied. Creates one admin login, a school year, sample
 * sections, teachers and subjects, so the admin screens are not
 * empty on a fresh clone.
 *
 *   cd server
 *   node db/seed_admin_demo.js
 *
 * The admin password is hashed here with the same bcrypt cost
 * (12) the real login flow uses, so — unlike a hand-written SQL
 * INSERT with a copy-pasted hash — this one is guaranteed to
 * actually match the printed password below.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

const DEMO_ADMIN_EMAIL = 'admin@ucc.edu.ph';
const DEMO_ADMIN_PASSWORD = 'ChangeMe!2026'; // change this immediately after first login

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [year] } = await client.query(
      `INSERT INTO school_years (label, opens_at, closes_at, is_active, enrollment_open)
       VALUES ('2026-2027', '2026-06-01', '2027-03-31', TRUE, TRUE)
       ON CONFLICT (label) DO UPDATE SET label = EXCLUDED.label
       RETURNING id`
    );

    const { rows: grades } = await client.query('SELECT id, name FROM grade_levels');
    for (const g of grades) {
      await client.query(
        `INSERT INTO sections (name, grade_level_id, school_year_id, capacity)
         VALUES ('Section A', $1, $2, 40)
         ON CONFLICT DO NOTHING`,
        [g.id, year.id]
      );
    }

    const passwordHash = await bcrypt.hash(DEMO_ADMIN_PASSWORD, 12);
    const { rows: [adminRole] } = await client.query(`SELECT id FROM roles WHERE name = 'admin'`);
    await client.query(
      `INSERT INTO users (email, password_hash, role_id, is_active)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (email) DO NOTHING`,
      [DEMO_ADMIN_EMAIL, passwordHash, adminRole.id]
    );

    const teachers = [
      ['Grace', 'Manalo', 'grace.manalo@ucc.edu.ph', 'BEEd', 'Early Childhood Education', '2021-06-01'],
      ['Juan', 'Cruz', 'juan.cruz@ucc.edu.ph', 'BSEd', 'Mathematics', '2019-06-01'],
      ['Liza', 'Reyes', 'liza.reyes@ucc.edu.ph', 'BSEd', 'Science', '2020-06-01'],
    ];
    for (const [firstName, lastName, email, degree, major, dateHired] of teachers) {
      await client.query(
        `INSERT INTO teachers (first_name, last_name, email, degree, major, date_hired)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (email) DO NOTHING`,
        [firstName, lastName, email, degree, major, dateHired]
      );
    }

    const grade4 = grades.find((g) => g.name === 'Grade 4');
    if (grade4) {
      for (const name of ['English', 'Mathematics', 'Science', 'Filipino', 'MAPEH']) {
        await client.query(
          `INSERT INTO subjects (name, grade_level_id, school_year_id, is_domain)
           VALUES ($1, $2, $3, FALSE) ON CONFLICT DO NOTHING`,
          [name, grade4.id, year.id]
        );
      }
    }

    await client.query('COMMIT');
    console.log('Seed complete.');
    console.log(`Admin login: ${DEMO_ADMIN_EMAIL} / ${DEMO_ADMIN_PASSWORD}`);
    console.log('Change that password immediately after your first login.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
