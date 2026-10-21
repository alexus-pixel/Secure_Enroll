import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getDashboardOverview, getDashboardApplications } from '../../api/admin';
import Pagination, { usePagination } from '../../components/Pagination';
import useAutoRefresh, { useAlive, keepIfSame } from '../../hooks/useAutoRefresh';

const STATUS_LABELS = {
  submitted: 'Submitted', under_review: 'Under Review', resubmitted: 'Resubmitted', needs_revision: 'Needs Revision',
  approved: 'Approved', rejected: 'Rejected', draft: 'Draft',
};

export default function DashboardPage() {
  const [overview, setOverview] = useState(null);
  const [applications, setApplications] = useState({ applications: [], total: 0 });
  const [filters, setFilters] = useState({ gradeLevelId: '', submittedDate: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const alive = useAlive();
  const loaded = useRef(false);

  // The status filter lives in the address bar, not in state, so the summary
  // boxes above can be ordinary links into this same list and a narrowed view
  // survives a bookmark, a reload or the browser Back button.
  const [searchParams, setSearchParams] = useSearchParams();
  // Anything not a real status is treated as no filter, so a mistyped link
  // shows the whole list rather than an empty table.
  const status = STATUS_LABELS[searchParams.get('status')] ? searchParams.get('status') : '';
  const setStatus = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('status', value); else next.delete('status');
    setSearchParams(next, { replace: true });
  };

  // Stable so the auto-refresh interval is not torn down on every render.
  const load = useCallback(() => {
    getDashboardOverview()
      .then((data) => { if (alive.current) { loaded.current = true; setOverview((prev) => keepIfSame(prev, data)); } })
      // A background refresh that fails leaves the numbers already on screen
      // alone: only the very first attempt replaces the page with an error.
      .catch((err) => { if (alive.current && !loaded.current) setError(err.response?.data?.message || 'Could not load the dashboard.'); })
      .finally(() => { if (alive.current) setLoading(false); });
    getDashboardApplications({ status, ...filters })
      .then((data) => { if (alive.current) setApplications((prev) => keepIfSame(prev, data)); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, filters.gradeLevelId, filters.submittedDate]);

  useEffect(() => { load(); }, [load]);
  // Counts and the enrollee list are read-only here, so re-reading them under
  // the user never loses anything they were in the middle of.
  useAutoRefresh(load);

  const applicationsPager = usePagination(applications.applications);

  if (loading) return <div className="empty-state">Loading dashboard...</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!overview) return null;

  const { schoolYear, summary, byGrade, statusBreakdown, registrarActivity } = overview;
  const totalStatus = statusBreakdown.reduce((sum, s) => sum + s.count, 0) || 1;
  const gradeLevels = byGrade.map((g) => ({ id: g.id, name: g.name }));

  // Each box opens the enrollee list below, already narrowed to the status it
  // counts. "New this week" has no status of its own - a week is a date range,
  // not a state - so it opens the newly submitted applications, which is what
  // the box is there to chase up.
  const statCards = [
    { label: 'New this week', listLabel: 'newly submitted', value: summary.new_this_week, status: 'submitted' },
    { label: 'Under review', listLabel: 'under review', value: summary.under_review, status: 'under_review' },
    { label: 'Needs revision', listLabel: 'needs revision', value: summary.needs_revision, status: 'needs_revision' },
    { label: `Approved (SY ${schoolYear.label})`, listLabel: 'approved', value: summary.approved, status: 'approved' },
  ];

  return (
    <div>
      {/* These rules belong in admin.css next to .admin-stat-card; they sit here
          because that stylesheet is being edited elsewhere. */}
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>School Year {schoolYear.label}</p>
        </div>
      </div>

      <div className="admin-stats-row">
        {statCards.map((c) => (
          <Link
            key={c.label}
            className={`admin-stat-card admin-stat-link${status === c.status ? ' is-current' : ''}`}
            to={{ search: `?status=${c.status}` }}
            aria-label={`${c.label}: show the ${c.listLabel} applications below`}
          >
            <div className="admin-stat-value">{c.value}</div>
            <div className="admin-stat-label">{c.label}</div>
          </Link>
        ))}
      </div>

      <div className="card card-flush">
        <div style={{ padding: '18px 20px 0' }}>
          <h2>Enrollees</h2>
        </div>
        <div className="admin-filters-row" style={{ padding: '0 20px' }}>
          <select
            className="admin-filter-input"
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).filter(([value]) => value !== 'draft').map(([value, label]) => (
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
          {status === 'submitted' && (
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
              {applicationsPager.pageRows.map((a) => (
                <tr key={a.id}>
                  <td><b>{a.last_name}, {a.first_name}</b></td>
                  <td>{a.grade_level}</td>
                  <td>
                    {a.guardian_first_name ? `${a.guardian_first_name} ${a.guardian_last_name}` : '\u2014'}
                    <div className="cell-sub">Guardian</div>
                  </td>
                  <td>{new Date(a.submitted_at).toLocaleDateString()}</td>
                  <td><span className={`pill pill-${a.status}`}>{STATUS_LABELS[a.status] || a.status}</span></td>
                  <td><Link className="btn btn-secondary btn-sm" to={`/admin/applications/${a.id}`}>Review</Link></td>
                </tr>
              ))}
              {applicationsPager.total === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)' }}>No applications match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={applicationsPager.page}
          totalPages={applicationsPager.totalPages}
          total={applicationsPager.total}
          from={applicationsPager.from}
          to={applicationsPager.to}
          onPage={applicationsPager.setPage}
          label="applications"
        />
      </div>

      <div className="settings-grid" style={{ marginTop: 18 }}>
        <div className="card">
          <h2>Enrollment by Grade Level</h2>
          {byGrade.map((g) => (
            <div key={g.id} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
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
              <span style={{ fontSize: 14 }}>
                <b>{s.count}</b> <span className="muted">({Math.round((s.count / totalStatus) * 100)}%)</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2>Active Registrar Sessions</h2>
        {registrarActivity.length === 0 && <p className="muted" style={{ fontSize: 14.5 }}>No registrar activity yet.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {registrarActivity.map((r) => (
            <div key={r.id} className="card" style={{ margin: 0, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: r.is_active ? 'var(--success)' : 'var(--faint)',
                }} />
                <b style={{ fontSize: 14.5 }}>{r.email}</b>
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
