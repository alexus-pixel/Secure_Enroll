import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import LrnEntry from '../../components/registrar/LrnEntry';

const LIS_URL = 'https://lis.deped.gov.ph';

const fmt = (d) =>
  new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });

export default function MissingLrn() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [reloadKey, setReloadKey] = useState(0);
  const load = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let alive = true;
    api.get('/registrar/students/missing-lrn')
      .then(({ data }) => {
        if (!alive) return;
        setStudents(data.students);
        setError('');
      })
      .catch((err) => alive && setError(err.response?.data?.message || 'Could not load the list.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [reloadKey]);

  return (
    <div className="reg-page">
      <h1 className="reg-title">Students without an LRN</h1>
      <p className="reg-subtitle">
        Look up each learner in the official DepEd LIS portal, then enter the LRN here.
        Parents with an email on file are notified once it is saved.
      </p>

      <p>
        <a className="reg-link" href={LIS_URL} target="_blank" rel="noopener noreferrer">
          OPEN DEPED LIS PORTAL
        </a>
        {' · '}
        <Link className="reg-link" to="/registrar">BACK TO DASHBOARD</Link>
      </p>

      {loading && <p>Loading...</p>}
      {error && <p className="reg-notice reg-notice-error">{error}</p>}
      {!loading && !error && students.length === 0 && (
        <p>Every student in this school year has an LRN.</p>
      )}

      {students.length > 0 && (
        <div className="reg-table-wrap">
          <table className="reg-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Grade Level</th>
                <th>Submitted</th>
                <th>Enter LRN</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.studentId}>
                  <td className="reg-strong">{s.student}</td>
                  <td>{s.grade}</td>
                  <td>{fmt(s.submitted)}</td>
                  <td><LrnEntry studentId={s.studentId} onSaved={load} /></td>
                  <td>
                    <Link className="reg-link" to={`/registrar/applications/${s.applicationId}`}>
                      REVIEW
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}