const pool = require('../pool');

async function listSchoolYears() {
  const result = await pool.query(
    `SELECT id, label, opens_at, closes_at, is_active, enrollment_open,
            (closes_at <= CURRENT_DATE) AS is_ended
     FROM school_years ORDER BY opens_at DESC`
  );
  return result.rows;
}

// Pure integer arithmetic on the Y-M-D parts — deliberately never
// goes through `new Date(dateString)` + getMonth()/setMonth(),
// since those read and write in the server process's *local*
// timezone. A date-only string like "2030-06-01" parses as UTC
// midnight, so on a server running anywhere west of UTC that would
// silently read back as May, not June, before any month is even
// added — a one-day, once-a-year bug that would be brutal to
// notice. Only Date.UTC() is used, and only to ask "how many days
// does this month have", which is timezone-independent.
function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const total = (m - 1) + months;
  const newYear = y + Math.floor(total / 12);
  const newMonth = (total % 12) + 1;
  const daysInNewMonth = new Date(Date.UTC(newYear, newMonth, 0)).getUTCDate();
  const newDay = Math.min(d, daysInNewMonth); // e.g. Aug 31 + 10mo doesn't exist in June -> clamps to June 30
  return `${newYear}-${String(newMonth).padStart(2, '0')}-${String(newDay).padStart(2, '0')}`;
}

async function createSchoolYear({ label, opensAt, closesAt }) {
  // "Automatically stop 10 months after classes began" unless an
  // admin typed a specific end date.
  const finalClosesAt = closesAt || addMonths(opensAt, 10);
  const result = await pool.query(
    `INSERT INTO school_years (label, opens_at, closes_at, is_active, enrollment_open)
     VALUES ($1, $2, $3, FALSE, FALSE)
     RETURNING id, label, opens_at, closes_at, is_active, enrollment_open`,
    [label, opensAt, finalClosesAt]
  );
  return result.rows[0];
}

async function isSchoolYearEditable(schoolYearId) {
  const result = await pool.query(
    'SELECT (closes_at > CURRENT_DATE) AS editable FROM school_years WHERE id = $1',
    [schoolYearId]
  );
  return result.rows[0]?.editable ?? false;
}

async function updateSchoolYearEndDate(id, closesAt) {
  const current = await pool.query('SELECT opens_at FROM school_years WHERE id = $1', [id]);
  if (!current.rows[0]) return null;
  if (closesAt <= current.rows[0].opens_at.toISOString().slice(0, 10)) {
    const err = new Error('End date must be after the start date.');
    err.status = 400;
    throw err;
  }
  const result = await pool.query(
    `UPDATE school_years SET closes_at = $2 WHERE id = $1
     RETURNING id, label, opens_at, closes_at, is_active, enrollment_open, (closes_at <= CURRENT_DATE) AS is_ended`,
    [id, closesAt]
  );
  return result.rows[0] || null;
}

async function setActiveSchoolYear(id) {
  // Only one school year is ever "active" at a time — flipping this
  // on for one row and off for every other row happens in the same
  // transaction so there is never a moment with zero or two active
  // years, even if this request races with another one.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE school_years SET is_active = FALSE WHERE is_active = TRUE');
    const result = await client.query(
      `UPDATE school_years SET is_active = TRUE WHERE id = $1
       RETURNING id, label, is_active`,
      [id]
    );
    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listGradeLevels() {
  const result = await pool.query('SELECT id, name FROM grade_levels ORDER BY sort_order');
  return result.rows;
}

async function listSectionsWithEnrollment(schoolYearId) {
  const result = await pool.query(
    `SELECT sec.id, sec.name, sec.capacity, gl.id AS grade_level_id, gl.name AS grade_level_name,
            COUNT(ea.id) FILTER (WHERE ea.status IN ('submitted','under_review','approved'))::int AS enrolled_count
     FROM sections sec
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     LEFT JOIN enrollment_applications ea ON ea.section_id = sec.id
     WHERE sec.school_year_id = $1
     GROUP BY sec.id, gl.id
     ORDER BY gl.sort_order, sec.name`,
    [schoolYearId]
  );
  return result.rows;
}

async function createSection({ name, gradeLevelId, schoolYearId, capacity }) {
  const result = await pool.query(
    `INSERT INTO sections (name, grade_level_id, school_year_id, capacity)
     VALUES ($1, $2, $3, $4) RETURNING id, name, capacity`,
    [name, gradeLevelId, schoolYearId, capacity]
  );
  return result.rows[0];
}

async function updateSectionCapacity(id, capacity) {
  // A section can't be shrunk below how many are already enrolled
  // in it — that would silently make the section "over capacity"
  // without ever telling the admin why the number turned red.
  const enrolled = await pool.query(
    `SELECT COUNT(*)::int AS count FROM enrollment_applications
     WHERE section_id = $1 AND status IN ('submitted','under_review','approved')`,
    [id]
  );
  if (capacity < enrolled.rows[0].count) {
    const err = new Error(`This section already has ${enrolled.rows[0].count} enrolled. Capacity can't go below that.`);
    err.status = 409;
    throw err;
  }
  const result = await pool.query(
    'UPDATE sections SET capacity = $2 WHERE id = $1 RETURNING id, name, capacity',
    [id, capacity]
  );
  return result.rows[0] || null;
}

async function deleteSection(id) {
  // A section with real, currently-enrolled students can't just be
  // deleted — those application records would either orphan or (via
  // the FK) cascade-delete along with it, silently destroying real
  // enrollment data. A section with schedule_entries but no
  // enrollment (e.g. a section being restructured before the year
  // starts) is fine to remove; those rows cascade-delete via the
  // existing schedule_entries.section_id FK, the same way removing
  // a subject frees up whatever it was linked to.
  const enrolled = await pool.query(
    `SELECT COUNT(*)::int AS count FROM enrollment_applications
     WHERE section_id = $1 AND status IN ('submitted','under_review','approved')`,
    [id]
  );
  if (enrolled.rows[0].count > 0) {
    const err = new Error(`This section has ${enrolled.rows[0].count} enrolled student(s) and can't be removed.`);
    err.status = 409;
    throw err;
  }
  const result = await pool.query('DELETE FROM sections WHERE id = $1 RETURNING id', [id]);
  return result.rows[0] || null;
}

module.exports = {
  listSchoolYears, createSchoolYear, setActiveSchoolYear, isSchoolYearEditable, updateSchoolYearEndDate,
  listGradeLevels, listSectionsWithEnrollment, createSection, updateSectionCapacity, deleteSection,
};
