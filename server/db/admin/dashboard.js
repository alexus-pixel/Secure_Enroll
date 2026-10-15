const pool = require('../pool');

async function getSummaryCounts(schoolYearId) {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE submitted_at >= NOW() - INTERVAL '7 days')::int AS new_this_week,
       COUNT(*) FILTER (WHERE status = 'under_review')::int AS under_review,
       COUNT(*) FILTER (WHERE status = 'needs_revision')::int AS needs_revision,
       COUNT(*) FILTER (WHERE status = 'approved')::int AS approved
     FROM enrollment_applications WHERE school_year_id = $1`,
    [schoolYearId]
  );
  return result.rows[0];
}

/**
 * The "submitted" date filter is deliberately bounded to the
 * enrollment period (opens_at/closes_at on the active school
 * year), matching "based only on the start of the enrollment
 * period" in the flow doc — a date outside that window can't
 * match anything, so the UI's date picker min/max should mirror
 * these same two values.
 */
async function listApplications({ schoolYearId, status, gradeLevelId, submittedDate, page = 1, limit = 20 }) {
  const clauses = ['ea.school_year_id = $1'];
  const params = [schoolYearId];

  if (status) {
    params.push(status);
    clauses.push(`ea.status = $${params.length}`);
  }
  if (gradeLevelId) {
    params.push(gradeLevelId);
    clauses.push(`ea.grade_level_id = $${params.length}`);
  }
  if (submittedDate) {
    params.push(submittedDate);
    clauses.push(`ea.submitted_at::date = $${params.length}::date`);
  }

  const where = `WHERE ${clauses.join(' AND ')}`;
  const offset = (page - 1) * limit;

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM enrollment_applications ea ${where}`, params
  );
  const rowsResult = await pool.query(
    `SELECT ea.id, s.first_name, s.last_name, gl.name AS grade_level, ea.status, ea.submitted_at,
            g.first_name AS guardian_first_name, g.last_name AS guardian_last_name
     FROM enrollment_applications ea
     JOIN students s ON s.id = ea.student_id
     JOIN grade_levels gl ON gl.id = ea.grade_level_id
     LEFT JOIN student_guardians sg ON sg.student_id = s.id AND sg.is_primary = TRUE
     LEFT JOIN guardians g ON g.user_id = sg.guardian_id
     ${where}
     ORDER BY ea.submitted_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  return { applications: rowsResult.rows, total: countResult.rows[0].total, page, limit };
}

async function getEnrollmentByGrade(schoolYearId) {
  const result = await pool.query(
    `SELECT gl.name, gl.sort_order,
            COUNT(ea.id) FILTER (WHERE ea.status IN ('submitted','under_review','approved'))::int AS enrolled,
            COALESCE(SUM(sec.capacity), 0)::int AS capacity
     FROM grade_levels gl
     LEFT JOIN enrollment_applications ea ON ea.grade_level_id = gl.id AND ea.school_year_id = $1
     LEFT JOIN sections sec ON sec.grade_level_id = gl.id AND sec.school_year_id = $1
     GROUP BY gl.id, gl.name, gl.sort_order
     ORDER BY gl.sort_order`,
    [schoolYearId]
  );
  return result.rows;
}

async function getStatusBreakdown(schoolYearId) {
  const result = await pool.query(
    `SELECT status, COUNT(*)::int AS count
     FROM enrollment_applications WHERE school_year_id = $1
     GROUP BY status`,
    [schoolYearId]
  );
  return result.rows;
}

/**
 * There is no separate "sessions" table — a registrar's session is
 * inferred from their own audit trail, which we already have and
 * already trust: their most recent action is both "what they last
 * did" and, if it happened inside the active-session window, why
 * they still count as "active" right now. This avoids a second
 * source of truth that could drift from the audit log.
 */
async function getRegistrarActivity(activeWindowMinutes = 15) {
  const result = await pool.query(
    `SELECT DISTINCT ON (u.id)
            u.id, u.email, al.action, al.entity_type, al.entity_id, al.created_at,
            (al.created_at >= NOW() - ($1 || ' minutes')::interval) AS is_active
     FROM audit_logs al
     JOIN users u ON u.id = al.user_id
     JOIN roles r ON r.id = u.role_id
     WHERE r.name = 'registrar'
     ORDER BY u.id, al.created_at DESC`,
    [activeWindowMinutes]
  );
  return result.rows.sort((a, b) => (b.is_active - a.is_active) || (new Date(b.created_at) - new Date(a.created_at)));
}

module.exports = { getSummaryCounts, listApplications, getEnrollmentByGrade, getStatusBreakdown, getRegistrarActivity };
