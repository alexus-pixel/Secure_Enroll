import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppNav from '../components/AppNav';
import api from '../api/client';

const STATUS_LABELS = {
  draft: 'Draft', submitted: 'Submitted', under_review: 'Under Review',
  needs_revision: 'Needs Revision', approved: 'Approved', rejected: 'Rejected',
};

export default function Dashboard() {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);

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
            <p>School Year 2026&ndash;2027</p>
          </div>
          <Link className="btn btn-primary" to="/applications/new">+ New Application</Link>
        </div>

        <div className="card card-flush">
          {loading ? (
            <div className="empty-state">Loading...</div>
          ) : applications.length === 0 ? (
            <div className="empty-state">
              No applications yet. Start one with the button above.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Student</th><th>Grade Level</th><th>Section</th>
                    <th>Submitted</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((a) => (
                    <tr key={a.id}>
                      <td><b>{a.last_name}, {a.first_name}</b></td>
                      <td>{a.grade_level}</td>
                      <td>{a.section || '\u2014'}</td>
                      <td>{new Date(a.submitted_at).toLocaleDateString()}</td>
                      <td><span className={`pill pill-${a.status}`}>{STATUS_LABELS[a.status] || a.status}</span></td>
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