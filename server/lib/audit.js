const pool = require('../db/pool');

/**
 * Writes one row to the append-only audit_logs table. Every admin
 * mutation in this codebase calls this — creating a user, changing
 * a role, editing a schedule, toggling enrollment, exporting the
 * audit log itself. Nothing here can update or delete a row that
 * already exists.
 *
 * This is the same signature applicationController.js already
 * used inline; it now lives in one place instead of being
 * copy-pasted per controller.
 */
async function logAudit(userId, action, entityType, entityId, req, details) {
  await pool.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, user_agent, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      action,
      entityType || null,
      entityId || null,
      req?.ip || null,
      req?.get ? req.get('user-agent') : null,
      details ? JSON.stringify(details) : null,
    ]
  );
}

module.exports = { logAudit };
