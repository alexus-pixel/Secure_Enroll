import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppNav from '../components/AppNav';
import api from '../api/client';
import useEnrollment from '../hooks/useEnrollment';

const STATUS_LABELS = {
  draft: 'Draft', submitted: 'Submitted', under_review: 'Under Review', resubmitted: 'Resubmitted',
  needs_revision: 'Needs Revision', approved: 'Approved', rejected: 'Rejected',
};

export default function Dashboard() {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const enrollment = useEnrollment();

  useEffect(() => {
    api.get('/applications/mine').then((res) => setApplications(res.data)).finally(() => setLoading(false));
  }, []);

  return (
    <>
      <AppNav />
      <div className="container">
        <div className="page-head">
          <div>
            <h1>My Enrollment Applications</h1>
            <p>School Year {enrollment.enrollment?.schoolYear ? enrollment.enrollment.schoolYear.replace('-', '\u2013') : '2026\u20132027'}</p>
          </div>
          {enrollment.isClosed
            ? <span className="btn btn-primary btn-disabled" aria-disabled="true" title="Enrollment is closed">+ New Application</span>
            : <Link className="btn btn-primary" to="/applications/new">+ New Application</Link>}
        </div>

        {enrollment.enrollment && (
          <div className={`enroll-status${enrollment.isClosed ? ' is-closed' : ''}`} role="status">
            <span className="dot" aria-hidden="true" />
            <div><b>{enrollment.title}</b>{enrollment.message}</div>
          </div>
        )}

        <div className="card card-flush">
          {loading ? (
            <div className="empty-state">Loading...</div>
          ) : applications.length === 0 ? (
            <div className="empty-state">
              {enrollment.isClosed ? 'No applications yet. You can start one when enrollment opens.' : 'No applications yet. Start one with the button above.'}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data stack">
                <thead>
                  <tr>
                    <th>Student</th><th>Grade Level</th><th>Section</th>
                    <th>Submitted</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((a) => (
                    <tr key={a.id}>
                      <td data-label="Student"><b>{a.last_name}, {a.first_name}</b></td>
                      <td data-label="Grade">{a.grade_level}</td>
                      <td data-label="Section">{a.section || '\u2014'}</td>
                      <td data-label="Submitted">{new Date(a.submitted_at).toLocaleDateString()}</td>
                      <td data-label="Status"><span className={`pill pill-${a.status}`}>{STATUS_LABELS[a.status] || a.status}</span></td>
                      <td><Link to={`/applications/${a.id}`}>View</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}