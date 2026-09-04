const pool = require('./pool');

// ASSUMPTION: column names below (year_label, start_date, end_date, is_active
// on school_years; name, level_order on grade_levels; name, grade_level_id,
// capacity on sections) are guesses based on your table names in the
// concept paper. Check against schema.sql and adjust as needed.

// ---- School Years ----

async function getSchoolYears() {
  const { rows } = await pool.query(
    `SELECT id, year_label, is_active, start_date, end_date
     FROM school_years ORDER BY start_date DESC`
  );
  return rows;
}

async function createSchoolYear({ yearLabel, startDate, endDate }) {
  const { rows } = await pool.query(
    `INSERT INTO school_years (year_label, start_date, end_date, is_active)
     VALUES ($1, $2, $3, false) RETURNING *`,
    [yearLabel, startDate, endDate]
  );
  return rows[0];
}

async function setActiveSchoolYear(id) {
  // Only one school year should be active at a time, so clear the rest first.
  await pool.query(`UPDATE school_years SET is_active = false`);
  const { rows } = await pool.query(
    `UPDATE school_years SET is_active = true WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0];
}

// ---- Grade Levels ----

async function getGradeLevels() {
  const { rows } = await pool.query(
    `SELECT id, name, level_order FROM grade_levels ORDER BY level_order ASC`
  );
  return rows;
}

async function createGradeLevel({ name, levelOrder }) {
  const { rows } = await pool.query(
    `INSERT INTO grade_levels (name, level_order) VALUES ($1, $2) RETURNING *`,
    [name, levelOrder]
  );
  return rows[0];
}

// ---- Sections ----

async function getSections(gradeLevelId) {
  const query = gradeLevelId
    ? `SELECT id, name, grade_level_id, capacity FROM sections WHERE grade_level_id = $1 ORDER BY name`
    : `SELECT id, name, grade_level_id, capacity FROM sections ORDER BY grade_level_id, name`;
  const values = gradeLevelId ? [gradeLevelId] : [];
  const { rows } = await pool.query(query, values);
  return rows;
}

async function createSection({ name, gradeLevelId, capacity }) {
  const { rows } = await pool.query(
    `INSERT INTO sections (name, grade_level_id, capacity) VALUES ($1, $2, $3) RETURNING *`,
    [name, gradeLevelId, capacity]
  );
  return rows[0];
}

async function updateSection(id, { name, capacity }) {
  const { rows } = await pool.query(
    `UPDATE sections SET name = COALESCE($2, name), capacity = COALESCE($3, capacity)
     WHERE id = $1 RETURNING *`,
    [id, name ?? null, capacity ?? null]
  );
  return rows[0];
}

module.exports = {
  getSchoolYears,
  createSchoolYear,
  setActiveSchoolYear,
  getGradeLevels,
  createGradeLevel,
  getSections,
  createSection,
  updateSection,
};
