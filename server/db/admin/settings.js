const pool = require('../pool');

async function getActiveSchoolYear() {
  const result = await pool.query(
    `SELECT id, label, opens_at, closes_at, is_active, enrollment_open
     FROM school_years WHERE is_active = TRUE LIMIT 1`
  );
  return result.rows[0] || null;
}

async function updateEnrollmentPeriod(schoolYearId, { enrollmentOpen, opensAt, closesAt }) {
  const result = await pool.query(
    `UPDATE school_years SET enrollment_open = $2, opens_at = $3, closes_at = $4
     WHERE id = $1 RETURNING id, label, opens_at, closes_at, enrollment_open`,
    [schoolYearId, enrollmentOpen, opensAt, closesAt]
  );
  return result.rows[0] || null;
}

/**
 * "Grade level configuration, slots are based on slots per
 * section" — so the per-grade number shown on System Settings is a
 * read-only sum of that grade's own sections, not a separately
 * stored value. The actual capacity per section is edited from
 * School Settings' Manage popup; this just reports the total plus
 * how many of those seats are already spoken for.
 */
async function getGradeLevelSlotSummary(schoolYearId) {
  const result = await pool.query(
    `SELECT gl.id, gl.name, gl.sort_order,
            COALESCE(SUM(sec.capacity), 0)::int AS total_slots,
            COUNT(DISTINCT ea.id) FILTER (WHERE ea.status IN ('submitted','under_review','approved'))::int AS enrolled_count
     FROM grade_levels gl
     LEFT JOIN sections sec ON sec.grade_level_id = gl.id AND sec.school_year_id = $1
     LEFT JOIN enrollment_applications ea ON ea.grade_level_id = gl.id AND ea.school_year_id = $1
     GROUP BY gl.id, gl.name, gl.sort_order
     ORDER BY gl.sort_order`,
    [schoolYearId]
  );
  return result.rows;
}

async function getRequiredDocuments() {
  const result = await pool.query(
    'SELECT id, code, label, is_required FROM required_document_types ORDER BY sort_order'
  );
  return result.rows;
}

async function updateRequiredDocuments(documents) {
  // documents: [{ id, isRequired }]. One statement per row inside a
  // transaction, not a loop of independent queries, so a failure
  // partway through never leaves the checklist half-saved.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const doc of documents) {
      await client.query(
        'UPDATE required_document_types SET is_required = $2 WHERE id = $1',
        [doc.id, doc.isRequired]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getRequiredDocuments();
}

module.exports = {
  getActiveSchoolYear, updateEnrollmentPeriod, getGradeLevelSlotSummary,
  getRequiredDocuments, updateRequiredDocuments,
};
