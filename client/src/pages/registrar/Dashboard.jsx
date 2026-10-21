import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import StatusBadge from '../../components/registrar/StatusBadge';
import api from '../../api/client';
import useEnrollment from '../../hooks/useEnrollment';
import useAutoRefresh, { useAlive, keepIfSame } from '../../hooks/useAutoRefresh';
import Pagination, { usePagination } from '../../components/Pagination';

const fmt = (d) =>
  new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });

// Which rows each summary box stands for. The box counting "Under Review"
// counts resubmitted applications too (the server adds them together), so
// clicking it has to show both or the list would not add up to the number.
// "New this week" is a date range rather than a status, so it opens the newly
// submitted applications, which is the work the box is pointing at.
const STAT_FILTERS = {
  submitted: { label: 'newly submitted', match: (a) => a.status === 'submitted' },
  under_review: { label: 'under review', match: (a) => ['under_review', 'resubmitted'].includes(a.status) },
  needs_revision: { label: 'needing revision', match: (a) => a.status === 'needs_revision' },
  approved: { label: 'approved', match: (a) => a.status === 'approved' },
};

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const { year } = useEnrollment();
  const alive = useAlive();
  const loaded = useRef(false);

  // The chosen box lives in the address bar, so the boxes can be plain links
  // and the narrowed list survives a reload or the Back button.
  const [searchParams] = useSearchParams();
  const picked = STAT_FILTERS[searchParams.get('status')] ? searchParams.get('status') : '';

  const load = useCallback(() => {
    api
      .get('/registrar/applications')
      .then((res) => { if (alive.current) { loaded.current = true; setData((prev) => keepIfSame(prev, res.data)); } })
      // Only the first attempt reports a failure; a background refresh that
      // fails leaves what is already on screen alone.
      .catch((err) => { if (alive.current && !loaded.current) setError(err.response?.data?.message || 'Could not load applications.'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);
  // The list and the counts are read-only here, so nothing the registrar is
  // part-way through can be lost by re-reading them.
  useAutoRefresh(load);

  // Memoised, or the pager would see a new list on every render and send the
  // registrar back to page 1.
  const allApplications = useMemo(() => data?.applications || [], [data]);
  const shown = useMemo(
    () => (picked ? allApplications.filter(STAT_FILTERS[picked].match) : allApplications),
    [allApplications, picked],
  );
  const pager = usePagination(shown);

  if (error) return <div className="reg-page"><p style={{ color: '#b91c1c' }}>{error}</p></div>;
  if (!data) return <div className="reg-page"><p>Loading...</p></div>;

  const s = data.stats;
  const stats = [
    { value: s.newThisWeek, label: 'New this week', status: 'submitted' },
    { value: s.underReview, label: 'Under Review', status: 'under_review' },
    { value: s.needsRevision, label: 'Needs Revision', status: 'needs_revision' },
    { value: s.approved, label: year ? `Approved (SY ${year})` : 'Approved', status: 'approved' },
  ];

  // Same rule as the Missing LRN page: ignore drafts and rejected applications.
  const missing = allApplications.filter(
    (a) => a.missingLrn && !['draft', 'rejected'].includes(a.status)
  ).length;

  return (
    <div className="reg-page">
      {/* These rules belong in registrar.css next to .reg-stat-card; they sit
          here because that stylesheet is being edited elsewhere. */}
      <h1 className="reg-title">My Enrollment Applications</h1>
      <p className="reg-subtitle">{year ? `School Year ${year}` : ""}</p>

      {missing > 0 && (
        <p style={{ background: '#fef3c7', padding: '10px 14px', borderRadius: 6 }}>
          {missing} student{missing === 1 ? ' has' : 's have'} no LRN yet.{' '}
          <Link className="reg-link" to="/registrar/missing-lrn">ENTER LRNS</Link>
        </p>
      )}

      <div className="reg-stats">
        {stats.map((st) => (
          <Link
            className={`reg-stat-card reg-stat-link${picked === st.status ? ' is-current' : ''}`}
            key={st.label}
            to={{ search: `?status=${st.status}` }}
            aria-label={`${st.label}: show the ${STAT_FILTERS[st.status].label} applications below`}
          >
            <div className="reg-stat-value">{st.value}</div>
            <div className="reg-stat-label">{st.label}</div>
          </Link>
        ))}
      </div>

      {picked && (
        <p className="reg-muted-small" style={{ margin: '12px 0 0' }}>
          Showing {shown.length} application{shown.length === 1 ? '' : 's'} {STAT_FILTERS[picked].label}.{' '}
          <Link className="reg-link" to={{ search: '' }}>SHOW ALL</Link>
        </p>
      )}

      <div className="reg-table-wrap">
        <table className="reg-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Grade Level</th>
              <th>Guardian</th>
              <th>Submitted</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pager.total === 0 && (
              <tr><td colSpan={6}>{picked ? 'No applications in this status.' : 'No applications yet.'}</td></tr>
            )}
            {pager.pageRows.map((a) => (
              <tr key={a.id}>
                <td className="reg-strong">
                  {a.student}
                  {a.missingLrn && (
                    <span style={{ marginLeft: 8, fontSize: 13.5, color: '#b45309' }}>No LRN</span>
                  )}
                </td>
                <td>{a.grade}</td>
                <td>
                  {a.guardian}
                  <div className="reg-muted-small">Guardian</div>
                </td>
                <td>{fmt(a.submitted)}</td>
                <td><StatusBadge status={a.status} /></td>
                <td>
                  {/* Somebody already has it open. Saying so here saves the
                      walk into a page where every button is greyed out. */}
                  {a.reviewedBy ? (
                    <Link className="reg-link" to={`/registrar/applications/${a.id}`} style={{ opacity: .75 }}
                      title={`${a.reviewedBy} opened this application and has it until they are finished`}>
                      UNDER REVIEW BY {String(a.reviewedByRole || a.reviewedBy).toUpperCase()}
                    </Link>
                  ) : (
                    <Link className="reg-link" to={`/registrar/applications/${a.id}`}>REVIEW</Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={pager.page}
        totalPages={pager.totalPages}
        total={pager.total}
        from={pager.from}
        to={pager.to}
        onPage={pager.setPage}
        label="applications"
      />
    </div>
  );
}