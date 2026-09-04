import { useState, useEffect } from 'react';
import { getAuditLogs } from '../../api/admin';
import { AUDIT_ACTION_OPTIONS } from '../../constants/adminOptions';

export default function AuditLogViewer() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ action: '', startDate: '', endDate: '' });
  const [loading, setLoading] = useState(true);
  const limit = 25;

  async function load() {
    setLoading(true);
    try {
      const data = await getAuditLogs({ ...filters, page, limit });
      setLogs(data.logs);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function applyFilters(e) {
    e.preventDefault();
    setPage(1);
    load();
  }

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div>
      <div className="admin-page-header">
        <h1>Audit log</h1>
      </div>

      <form onSubmit={applyFilters} className="admin-filters-row">
        <select
          value={filters.action}
          onChange={(e) => setFilters({ ...filters, action: e.target.value })}
          className="admin-filter-input"
        >
          <option value="">All actions</option>
          {AUDIT_ACTION_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input
          type="date"
          value={filters.startDate}
          onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
          className="admin-filter-input"
          style={{ maxWidth: 160 }}
        />
        <input
          type="date"
          value={filters.endDate}
          onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
          className="admin-filter-input"
          style={{ maxWidth: 160 }}
        />
        <button type="submit" className="admin-btn admin-btn-secondary">Apply</button>
      </form>

      {loading ? (
        <p>Loading logs...</p>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Details</th>
                  <th>IP address</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ color: 'var(--admin-text-secondary)', whiteSpace: 'nowrap' }}>
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td>{log.user_email || 'system'}</td>
                    <td><span className="admin-action-code">{log.action}</span></td>
                    <td style={{ color: 'var(--admin-text-secondary)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.details ? JSON.stringify(log.details) : '—'}
                    </td>
                    <td style={{ color: 'var(--admin-text-secondary)' }}>{log.ip_address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="admin-pagination">
            <button className="admin-row-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span>Page {page} of {totalPages}</span>
            <button className="admin-row-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
