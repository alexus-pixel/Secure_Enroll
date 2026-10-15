const auditDb = require('../../db/admin/auditlog');
const { toCsv } = require('../../lib/csv');
const { logAudit } = require('../../lib/audit');

async function list(req, res) {
  try {
    const { action, from, to, page, limit } = req.query;
    const result = await auditDb.listAuditLogs({
      action, from, to, page: Number(page) || 1, limit: Number(limit) || 25,
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load the audit log.' });
  }
}

async function actions(req, res) {
  try {
    res.json(await auditDb.distinctActions());
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load action list.' });
  }
}

/**
 * Exporting the audit log is itself a security-relevant action —
 * it's a copy of every account's activity leaving the system as a
 * file — so it gets logged too, same as everything else on this
 * page. That row also has entity_type/entity_id left null since it
 * doesn't refer to one specific record.
 */
async function exportCsv(req, res) {
  try {
    const { action, from, to } = req.query;
    const rows = await auditDb.listAllAuditLogsForExport({ action, from, to });
    const csv = toCsv(rows, [
      { label: 'Timestamp', value: (r) => new Date(r.created_at).toISOString() },
      { label: 'User', value: (r) => r.user_email || 'system' },
      { label: 'Action', value: 'action' },
      { label: 'Entity Type', value: 'entity_type' },
      { label: 'Entity ID', value: 'entity_id' },
      { label: 'IP Address', value: 'ip_address' },
    ]);

    await logAudit(req.user.id, 'AUDIT_LOG_EXPORTED', null, null, req, { filters: { action, from, to }, rowCount: rows.length });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not export the audit log.' });
  }
}

module.exports = { list, actions, exportCsv };
