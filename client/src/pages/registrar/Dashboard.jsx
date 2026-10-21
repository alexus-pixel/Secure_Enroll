import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import StatusBadge from '../../components/registrar/StatusBadge';
import api from '../../api/client';
import useEnrollment from '../../hooks/useEnrollment';
import Pagination, { usePagination } from '../../components/Pagination';

const fmt = (d) =>
  new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const { year } = useEnrollment();

  useEffect(() => {
    api
      .get('/registrar/applications')
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Could not load applications.'));
  }, []);

  const pager = usePagination(data?.applications);

  if (error) return <div className="reg-page"><p style={{ color: '#b91c1c' }}>{error}</p></div>;
  if (!data) return <div className="reg-page"><p>Loading...</p></div>;

  const { stats: s, applications } = data;
  const stats = [
    { value: s.newThisWeek, label: 'New this week' },
    { value: s.underReview, label: 'Under Review' },
    { value: s.needsRevision, label: 'Needs Revision' },
    { value: s.approved, label: year ? `Approved (SY ${year})` : 'Approved' },
  ];

  // Same rule as the Missing LRN page: ignore drafts and rejected applications.
  const missing = applications.filter(
    (a) => a.missingLrn && !['draft', 'rejected'].includes(a.status)
  ).length;

  return (
    <div className="reg-page">
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
          <div className="reg-stat-card" key={st.label}>
            <div className="reg-stat-value">{st.value}</div>
            <div className="reg-stat-label">{st.label}</div>
          </div>
        ))}
      </div>

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
              <tr><td colSpan={6}>No applications yet.</td></tr>
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
                  <Link className="reg-link" to={`/registrar/applications/${a.id}`}>REVIEW</Link>
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