import { useCallback, useEffect, useRef, useState } from 'react';
import { getDashboardOverview } from '../../api/admin';
import useAutoRefresh, { useAlive, keepIfSame } from '../../hooks/useAutoRefresh';

const STATUS_LABELS = {
  submitted: 'Submitted', under_review: 'Under Review', resubmitted: 'Resubmitted', needs_revision: 'Needs Revision',
  approved: 'Approved', rejected: 'Rejected', draft: 'Draft',
};

export default function DashboardPage() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const alive = useAlive();
  const loaded = useRef(false);

  // Stable so the auto-refresh interval is not torn down on every render.
  const load = useCallback(() => {
    getDashboardOverview()
      .then((data) => { if (alive.current) { loaded.current = true; setOverview((prev) => keepIfSame(prev, data)); } })
      // A background refresh that fails leaves the numbers already on screen
      // alone: only the very first attempt replaces the page with an error.
      .catch((err) => { if (alive.current && !loaded.current) setError(err.response?.data?.message || 'Could not load the dashboard.'); })
      .finally(() => { if (alive.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);
  // The numbers are read-only here, so re-reading them under the user never
  // loses anything they were in the middle of.
  useAutoRefresh(load);

  if (loading) return <div className="empty-state">Loading dashboard...</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!overview) return null;

  const { schoolYear, summary, byGrade, statusBreakdown, registrarActivity } = overview;
  const totalStatus = statusBreakdown.reduce((sum, s) => sum + s.count, 0) || 1;

  // Counts only. The administrator sees how enrollment is going, never an
  // individual learner's record: reviewing and deciding applications is the
  // registrar's work (concept paper, least privilege).
  const statCards = [
    { label: 'New this week', value: summary.new_this_week },
    { label: 'Under review', value: summary.under_review },
    { label: 'Needs revision', value: summary.needs_revision },
    { label: `Approved (SY ${schoolYear.label})`, value: summary.approved },
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>School Year {schoolYear.label}</p>
        </div>
      </div>

      <div className="admin-stats-row">
        {statCards.map((c) => (
          <div key={c.label} className="admin-stat-card">
            <div className="admin-stat-value">{c.value}</div>
            <div className="admin-stat-label">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="settings-grid">
        <div className="card">
          <h2>Enrollment by Grade Level</h2>
          {byGrade.map((g) => (
            <div key={g.name} style={{ marginBottom: 12 }}>
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
