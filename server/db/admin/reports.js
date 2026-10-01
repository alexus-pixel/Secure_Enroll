const pool = require('../pool');

// Every report takes an optional [from, to] date range (submitted_at
// for application-based reports, created_at for audit-log-based
// ones); omitting both means "all time" rather than forcing a
// default window that would silently hide older records from an
// admin who didn't ask for a filtered view.
function dateFilter(column, from, to, paramsSoFar) {
  const clauses = [];
  const params = [...paramsSoFar];
  if (from) { params.push(from); clauses.push(`${column} >= $${params.length}`); }
  if (to) { params.push(to); clauses.push(`${column} <= $${params.length}::date + INTERVAL '1 day'`); }
  return { clause: clauses.length ? `AND ${clauses.join(' AND ')}` : '', params };
}

async function masterEnrollmentList({ schoolYearId, from, to }) {
  const { clause, params } = dateFilter('ea.submitted_at', from, to, [schoolYearId]);
  const result = await pool.query(
    `SELECT s.first_name, s.middle_name, s.last_name,
            pgp_sym_decrypt(s.lrn_encrypted, $${params.length + 1})::text AS lrn,
            gl.name AS grade_level, sec.name AS section,
            g.first_name || ' ' || g.last_name AS guardian_name,
            pgp_sym_decrypt(g.contact_number, $${params.length + 1})::text AS guardian_contact,
            ea.submitted_at, ea.status
     FROM enrollment_applications ea
     JOIN students s ON s.id = ea.student_id
     JOIN grade_levels gl ON gl.id = ea.grade_level_id
     LEFT JOIN sections sec ON sec.id = ea.section_id
     LEFT JOIN student_guardians sg ON sg.student_id = s.id AND sg.is_primary = TRUE
     LEFT JOIN guardians g ON g.user_id = sg.guardian_id
     WHERE ea.school_year_id = $1 AND ea.status = 'approved' ${clause}
     ORDER BY s.last_name, s.first_name`,
    [...params, process.env.ENCRYPTION_KEY]
  );
  return result.rows;
}

async function applicationStatusReport({ schoolYearId, from, to }) {
  const { clause, params } = dateFilter('ea.submitted_at', from, to, [schoolYearId]);
  const result = await pool.query(
    `SELECT gl.name AS grade_level, ea.status, COUNT(*)::int AS count
     FROM enrollment_applications ea
     JOIN grade_levels gl ON gl.id = ea.grade_level_id
     WHERE ea.school_year_id = $1 ${clause}
     GROUP BY gl.name, gl.sort_order, ea.status
     ORDER BY gl.sort_order, ea.status`,
    params
  );
  return result.rows;
}

async function pendingApplications({ schoolYearId, from, to }) {
  const { clause, params } = dateFilter('ea.submitted_at', from, to, [schoolYearId]);
  const result = await pool.query(
    `SELECT s.first_name, s.last_name, gl.name AS grade_level, ea.status, ea.submitted_at,
            COUNT(d.id) FILTER (WHERE d.status = 'pending')::int AS pending_documents
     FROM enrollment_applications ea
     JOIN students s ON s.id = ea.student_id
     JOIN grade_levels gl ON gl.id = ea.grade_level_id
     LEFT JOIN documents d ON d.application_id = ea.id
     WHERE ea.school_year_id = $1 AND ea.status IN ('submitted', 'under_review', 'needs_revision') ${clause}
     GROUP BY ea.id, s.first_name, s.last_name, gl.name, gl.sort_order, ea.status, ea.submitted_at
     ORDER BY gl.sort_order, ea.submitted_at`,
    params
  );
  return result.rows;
}

async function registrarActivityReport({ from, to }) {
  const { clause, params } = dateFilter('al.created_at', from, to, []);
  const result = await pool.query(
    `SELECT u.email AS registrar_email, al.action, al.entity_type, al.entity_id, al.created_at
     FROM audit_logs al
     JOIN users u ON u.id = al.user_id
     JOIN roles r ON r.id = u.role_id
     WHERE r.name = 'registrar' ${clause}
     ORDER BY al.created_at DESC`,
    params
  );
  return result.rows;
}

/**
 * Flags applications that plausibly duplicate another one: the
 * same LRN submitted twice, or the same full name plus birth date
 * appearing on two different application records. Either is a
 * strong sign of the same child enrolled twice rather than two
 * different children who happen to share a name.
 */
async function duplicateFlagsReport({ schoolYearId, from, to }) {
  const { clause, params } = dateFilter('ea.submitted_at', from, to, [schoolYearId]);
  const result = await pool.query(
    `WITH candidates AS (
       SELECT ea.id AS application_id, ea.submitted_at, ea.status,
              s.first_name, s.last_name,
              pgp_sym_decrypt(s.birth_date, $${params.length + 1})::date AS birth_date,
              pgp_sym_decrypt(s.lrn_encrypted, $${params.length + 1})::text AS lrn
       FROM enrollment_applications ea
       JOIN students s ON s.id = ea.student_id
       WHERE ea.school_year_id = $1 ${clause}
     )
     SELECT c1.application_id, c1.first_name, c1.last_name, c1.birth_date, c1.lrn, c1.submitted_at, c1.status,
            CASE WHEN c1.lrn = c2.lrn THEN 'same LRN' ELSE 'same name + birth date' END AS flag_reason
     FROM candidates c1
     JOIN candidates c2 ON c2.application_id <> c1.application_id
       AND ((c1.lrn IS NOT NULL AND c1.lrn = c2.lrn)
         OR (LOWER(c1.first_name) = LOWER(c2.first_name) AND LOWER(c1.last_name) = LOWER(c2.last_name) AND c1.birth_date = c2.birth_date))
     ORDER BY c1.last_name, c1.first_name, c1.submitted_at`,
    [...params, process.env.ENCRYPTION_KEY]
  );
  // The JOIN above naturally produces one row per (flagged record,
  // matching partner) pair, so a genuine 3-way duplicate would
  // otherwise show up more than once per record — de-duplicated by
  // application_id here since the report should list each flagged
  // record once, with its reason, not once per partner it matches.
  const seen = new Map();
  for (const row of result.rows) if (!seen.has(row.application_id)) seen.set(row.application_id, row);
  return [...seen.values()];
}

async function gradeLevelCapacityReport(schoolYearId) {
  const result = await pool.query(
    `SELECT gl.name AS grade_level,
            COALESCE(SUM(sec.capacity), 0)::int AS total_capacity,
            COUNT(ea.id) FILTER (WHERE ea.status = 'approved')::int AS enrolled
     FROM grade_levels gl
     LEFT JOIN sections sec ON sec.grade_level_id = gl.id AND sec.school_year_id = $1
     LEFT JOIN enrollment_applications ea ON ea.grade_level_id = gl.id AND ea.school_year_id = $1 AND ea.status = 'approved'
     GROUP BY gl.id, gl.name, gl.sort_order
     ORDER BY gl.sort_order`,
    [schoolYearId]
  );
  return result.rows;
}

module.exports = {
  masterEnrollmentList, applicationStatusReport, pendingApplications,
  registrarActivityReport, duplicateFlagsReport, gradeLevelCapacityReport,
};
