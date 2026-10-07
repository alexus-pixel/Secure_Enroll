import { Link } from 'react-router-dom';
import StatusBadge from '../../components/registrar/StatusBadge';
import { mockStats, mockApplications } from '../../data/mockApplications';

export default function Dashboard() {
  const stats = [
    { value: mockStats.newThisWeek, label: 'New this week' },
    { value: mockStats.underReview, label: 'Under Review' },
    { value: mockStats.needsRevision, label: 'Needs Revision' },
    { value: mockStats.approved, label: 'Approved (SY 2026-2027)' },
  ];

  return (
    <div className="reg-page">
      <h1 className="reg-title">My Enrollment Applications</h1>
      <p className="reg-subtitle">School Year 2026 - 2027</p>

      <div className="reg-stats">
        {stats.map((s) => (
          <div className="reg-stat-card" key={s.label}>
            <div className="reg-stat-value">{s.value}</div>
            <div className="reg-stat-label">{s.label}</div>
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
            {mockApplications.map((a) => (
              <tr key={a.id}>
                <td className="reg-strong">{a.student}</td>
                <td>{a.grade}</td>
                <td>
                  {a.guardian}
                  <div className="reg-muted-small">Guardian</div>
                </td>
                <td>{a.submitted}</td>
                <td><StatusBadge status={a.status} /></td>
                <td><Link className="reg-link" to={`/registrar/applications/${a.id}`}>REVIEW</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}