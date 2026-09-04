const pool = require('./pool');

// ASSUMPTION: audit_logs columns are id, user_id, action, details, ip_address,
// created_at. Check this against your actual schema.sql and adjust column
// names below if they differ.

async function getAuditLogs({ userId, action, startDate, endDate, page = 1, limit = 50 } = {}) {
  const conditions = [];
  const values = [];
  let i = 1;

  if (userId) {
    conditions.push(`al.user_id = $${i++}`);
    values.push(userId);
  }
  if (action) {
    conditions.push(`al.action ILIKE $${i++}`);
    values.push(`%${action}%`);
  }
  if (startDate) {
    conditions.push(`al.created_at >= $${i++}`);
    values.push(startDate);
  }
  if (endDate) {
    conditions.push(`al.created_at <= $${i++}`);
    values.push(endDate);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const query = `
    SELECT al.id, al.user_id, u.email AS user_email, al.action, al.details, al.ip_address, al.created_at
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.user_id
    ${whereClause}
    ORDER BY al.created_at DESC
    LIMIT $${i++} OFFSET $${i++}
  `;
  const queryValues = [...values, limit, offset];

  const countQuery = `SELECT COUNT(*) FROM audit_logs al ${whereClause}`;

  const [rows, count] = await Promise.all([
    pool.query(query, queryValues),
    pool.query(countQuery, values),
  ]);

  return {
    logs: rows.rows,
    total: parseInt(count.rows[0].count, 10),
    page,
    limit,
  };
}

// Call this from any route (not just admin ones) to record an action.
// Kept here since audit_logs is its own concern, separate from whichever
// table the action actually touched.
async function recordAuditLog({ userId, action, details, ipAddress }) {
  await pool.query(
    `INSERT INTO audit_logs (user_id, action, details, ip_address, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [userId, action, details ? JSON.stringify(details) : null, ipAddress || null]
  );
}

module.exports = { getAuditLogs, recordAuditLog };
