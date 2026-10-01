const pool = require('../pool');

function buildLogFilters({ action, from, to }) {
  const clauses = [];
  const params = [];
  if (action) {
    params.push(action);
    clauses.push(`al.action = $${params.length}`);
  }
  if (from) {
    params.push(from);
    clauses.push(`al.created_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    clauses.push(`al.created_at <= $${params.length}`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

async function listAuditLogs({ action, from, to, page = 1, limit = 25 }) {
  const { where, params } = buildLogFilters({ action, from, to });
  const offset = (page - 1) * limit;

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM audit_logs al ${where}`, params
  );
  const rowsResult = await pool.query(
    `SELECT al.id, al.action, al.entity_type, al.entity_id, al.ip_address, al.details, al.created_at,
            u.email AS user_email
     FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
     ${where}
     ORDER BY al.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  return { logs: rowsResult.rows, total: countResult.rows[0].total, page, limit };
}

// No LIMIT here on purpose — CSV export is meant to hand back
// everything that matches the filters, not one page of it. The
// route that calls this should still be behind auth + audit.view,
// same as the paginated list.
async function listAllAuditLogsForExport({ action, from, to }) {
  const { where, params } = buildLogFilters({ action, from, to });
  const result = await pool.query(
    `SELECT al.created_at, u.email AS user_email, al.action, al.entity_type, al.entity_id, al.ip_address
     FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
     ${where}
     ORDER BY al.created_at DESC`,
    params
  );
  return result.rows;
}

async function distinctActions() {
  const result = await pool.query('SELECT DISTINCT action FROM audit_logs ORDER BY action');
  return result.rows.map((r) => r.action);
}

module.exports = { listAuditLogs, listAllAuditLogsForExport, distinctActions };
