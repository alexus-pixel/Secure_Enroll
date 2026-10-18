import { useEffect, useState } from 'react';
import { getDashboardOverview, getDashboardApplications } from '../../api/admin';

const STATUS_LABELS = {
  submitted: 'Submitted', under_review: 'Under Review', needs_revision: 'Needs Revision',
  approved: 'Approved', rejected: 'Rejected', draft: 'Draft',
};

export default function DashboardPage() {
  const [overview, setOverview] = useState(null);
  const [applications, setApplications] = useState({ applications: [], total: 0 });
  const [filters, setFilters] = useState({ status: '', gradeLevelId: '', submittedDate: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getDashboardOverview()
      .then(setOverview)
      .catch((err) => setError(err.response?.data?.message || 'Could not load the dashboard.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    getDashboardApplications(filters).then(setApplications).catch(() => {});
  }, [filters]);

  if (loading) return <div className="empty-state">Loading dashboard...</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!overview) return null;

  const { schoolYear, summary, byGrade, statusBreakdown, registrarActivity } = overview;
  const totalStatus = statusBreakdown.reduce((sum, s) => sum + s.count, 0) || 1;
  const gradeLevels = byGrade.map((g) => ({ id: g.id, name: g.name }));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>School Year {schoolYear.label}</p>
        </div>
      </div>

      <div className="admin-stats-row">
        <div className="admin-stat-card">
          <div className="admin-stat-value">{summary.new_this_week}</div>
          <div className="admin-stat-label">New this week</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value">{summary.under_review}</div>
          <div className="admin-stat-label">Under review</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value">{summary.needs_revision}</div>
          <div className="admin-stat-label">Needs revision</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value">{summary.approved}</div>
          <div className="admin-stat-label">Approved (SY {schoolYear.label})</div>
        </div>
      </div>

      <div className="card card-flush">
        <div style={{ padding: '18px 20px 0' }}>
          <h2>Enrollees</h2>
        </div>
        <div className="admin-filters-row" style={{ padding: '0 20px' }}>
          <select
            className="admin-filter-input"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            className="admin-filter-input"
            value={filters.gradeLevelId}
            onChange={(e) => setFilters({ ...filters, gradeLevelId: e.target.value })}
          >
            <option value="">All grade levels</option>
            {gradeLevels.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          {filters.status === 'submitted' && (
            <input
              type="date"
              className="admin-filter-input"
              min={schoolYear.opens_at?.slice(0, 10)}
              max={schoolYear.closes_at?.slice(0, 10)}
              value={filters.submittedDate}
              onChange={(e) => setFilters({ ...filters, submittedDate: e.target.value })}
            />
          )}
        </div>

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Student</th><th>Grade Level</th><th>Guardian</th>
                <th>Submitted</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {applications.applications.map((a) => (
                <tr key={a.id}>
                  <td><b>{a.last_name}, {a.first_name}</b></td>
                  <td>{a.grade_level}</td>
                  <td>
                    {a.guardian_first_name ? `${a.guardian_first_name} ${a.guardian_last_name}` : '\u2014'}
                    <div className="cell-sub">Guardian</div>
                  </td>
                  <td>{new Date(a.submitted_at).toLocaleDateString()}</td>
                  <td><span className={`pill pill-${a.status}`}>{STATUS_LABELS[a.status] || a.status}</span></td>
                  <td><span className="muted" style={{ fontSize: 12 }}>Review (registrar)</span></td>
                </tr>
              ))}
              {applications.applications.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)' }}>No applications match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="settings-grid" style={{ marginTop: 18 }}>
        <div className="card">
          <h2>Enrollment by Grade Level</h2>
          {byGrade.map((g) => (
            <div key={g.id} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                <span>{g.name}</span>
                <span className="muted">{g.enrolled}/{g.capacity}</span>
              </div>
              <div className="grade-card-fill-bar">
                <div style={{ width: `${g.capacity ? Math.min(100, (g.enrolled / g.capacity) * 100) : 0}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>Application Status Breakdown</h2>
          {statusBreakdown.map((s) => (
            <div key={s.status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0' }}>
              <span className={`pill pill-${s.status}`}>{STATUS_LABELS[s.status] || s.status}</span>
              <span style={{ fontSize: 12.5 }}>
                <b>{s.count}</b> <span className="muted">({Math.round((s.count / totalStatus) * 100)}%)</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2>Active Registrar Sessions</h2>
        {registrarActivity.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No registrar activity yet.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {registrarActivity.map((r) => (
            <div key={r.id} className="card" style={{ margin: 0, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: r.is_active ? 'var(--success)' : 'var(--faint)',
                }} />
                <b style={{ fontSize: 13 }}>{r.email}</b>
              </div>
              <div className="cell-sub" style={{ marginTop: 4 }}>{r.action}</div>
              <div className="cell-sub">{new Date(r.created_at).toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
