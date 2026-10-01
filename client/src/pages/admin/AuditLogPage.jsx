import { useEffect, useState } from 'react';
import { getAuditLogs, getAuditLogActions, downloadAuditLogCsv } from '../../api/admin';
import ColumnFilterIcon from './ColumnFilterIcon';

export default function AuditLogPage() {
  const [logs, setLogs] = useState([]);
  const [actions, setActions] = useState([]);
  const [filters, setFilters] = useState({ action: '', from: '', to: '' });
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { getAuditLogActions().then(setActions).catch(() => {}); }, []);
  useEffect(() => {
    getAuditLogs(filters).then((r) => setLogs(r.logs)).catch((err) => setError(err.response?.data?.message || 'Could not load the audit log.'));
  }, [filters]);

  async function handleExport() {
    setExporting(true);
    try {
      await downloadAuditLogCsv(filters);
    } catch {
      setError('Could not export the audit log.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Audit Log</h1>
          <p>Append-only security &amp; activity trail</p>
        </div>
        <button className="btn btn-secondary" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card card-flush">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>
                  <span className="th-head">
                    <span className="th-label">Timestamp</span>
                    <ColumnFilterIcon active={!!(filters.from || filters.to)}>
                      <label>From</label>
                      <input
                        type="date" className="admin-filter-input"
                        onChange={(e) => setFilters({ ...filters, from: e.target.value ? `${e.target.value}T00:00:00.000Z` : '' })}
                      />
                      <label>To</label>
                      <input
                        type="date" className="admin-filter-input"
                        onChange={(e) => setFilters({ ...filters, to: e.target.value ? `${e.target.value}T23:59:59.999Z` : '' })}
                      />
                    </ColumnFilterIcon>
                  </span>
                </th>
                <th><span className="th-head"><span className="th-label">User</span></span></th>
                <th>
                  <span className="th-head">
                    <span className="th-label">Action</span>
                    <ColumnFilterIcon active={!!filters.action}>
                      <label>Action</label>
                      <select
                        className="admin-filter-input"
                        value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}
                      >
                        <option value="">All</option>
                        {actions.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </ColumnFilterIcon>
                  </span>
                </th>
                <th><span className="th-head"><span className="th-label">Entity</span></span></th>
                <th><span className="th-head"><span className="th-label">IP Address</span></span></th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleString()}</td>
                  <td>{log.user_email || 'system'}</td>
                  <td>
                    <span className={`action-code ${log.action?.includes('FAILED') ? 'action-failed' : ''}`} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 600 }}>
                      {log.action}
                    </span>
                  </td>
                  <td className="cell-sub">{log.entity_type ? `${log.entity_type} #${log.entity_id}` : '\u2014'}</td>
                  <td className="cell-sub">{log.ip_address || '\u2014'}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>No activity yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
