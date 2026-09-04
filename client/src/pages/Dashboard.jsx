import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/applications/mine').then((res) => setApplications(res.data)).finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h1>My Enrollment Applications</h1>
        <button onClick={logout}>Log out</button>
      </div>
      <p>Signed in as {user?.email} ({user?.role})</p>
      <Link to="/applications/new">+ New Application</Link>
      {loading ? <p>Loading...</p> : applications.length === 0 ? <p>No applications yet.</p> : (
        <table border="1" cellPadding="8" style={{ marginTop: 16, borderCollapse: 'collapse' }}>
          <thead><tr><th>Student</th><th>Grade</th><th>School Year</th><th>Status</th><th>Submitted</th></tr></thead>
          <tbody>
            {applications.map((a) => (
              <tr key={a.id}>
                <td>{a.last_name}, {a.first_name}</td><td>{a.grade_level}</td><td>{a.school_year}</td>
                <td>{a.status}</td><td>{new Date(a.submitted_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}