const pool = require('../pool');
const { gradeSeats } = require('../../lib/seats');

async function getSummaryCounts(schoolYearId) {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE submitted_at >= NOW() - INTERVAL '7 days')::int AS new_this_week,
       COUNT(*) FILTER (WHERE status IN ('under_review', 'resubmitted'))::int AS under_review,
       COUNT(*) FILTER (WHERE status = 'needs_revision')::int AS needs_revision,
       COUNT(*) FILTER (WHERE status = 'approved')::int AS approved
     FROM enrollment_applications WHERE school_year_id = $1`,
    [schoolYearId]
  );
  return result.rows[0];
}

async function getEnrollmentByGrade(schoolYearId) {
  // Same seat rule as System Settings and School Settings (lib/seats.js).
  const seats = await gradeSeats(pool, schoolYearId);
  return seats.map((g) => ({ name: g.name, sort_order: g.sortOrder, enrolled: g.taken, capacity: g.capacity, slots_left: g.left }));
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

module.exports = { getSummaryCounts, getEnrollmentByGrade, getStatusBreakdown, getRegistrarActivity };