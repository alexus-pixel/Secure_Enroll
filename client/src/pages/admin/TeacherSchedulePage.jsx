import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate, useOutletContext } from 'react-router-dom';
import { getTeacher, getTeacherSchedule, sendTeacherPdf } from '../../api/admin';

const DAY_LABELS = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };

export default function TeacherSchedulePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { setCrumb } = useOutletContext();
  const [teacher, setTeacher] = useState(null);
  const [schedule, setSchedule] = useState({ entries: [], weeklyLoadCap: 24 });
  const [sendState, setSendState] = useState('idle'); // idle | sending | sent | error
  const [sendMessage, setSendMessage] = useState('');

  useEffect(() => {
    getTeacher(id).then((t) => {
      setTeacher(t);
      setCrumb(`${t.last_name}, ${t.first_name}`);
    }).catch(() => {});
    getTeacherSchedule(id).then(setSchedule).catch(() => {});
    return () => setCrumb('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSendPdf() {
    setSendState('sending');
    setSendMessage('');
    try {
      await sendTeacherPdf(id);
      setSendState('sent');
    } catch (err) {
      setSendState('error');
      setSendMessage(err.response?.data?.message || 'Could not send the PDF.');
    }
  }

  if (!teacher) return <div className="empty-state">Loading...</div>;

  return (
    <div>
      <Link to="/admin/teachers" className="back-link">&larr; Back to Teachers</Link>
      <div className="page-head">
        <div>
          <h1>{teacher.first_name} {teacher.last_name} — Schedule</h1>
          <p>{teacher.email}</p>
        </div>
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={handleSendPdf} disabled={sendState === 'sending'}>
            {sendState === 'sending' ? 'Sending...' : 'Send PDF'}
          </button>
          <button className="btn btn-primary" onClick={() => navigate(`/admin/teachers/${id}/assignments`)}>
            Assign New Class
          </button>
        </div>
      </div>

      {sendState === 'sent' && <div className="alert" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>PDF sent to your admin email.</div>}
      {sendState === 'error' && <div className="alert alert-error">{sendMessage}</div>}

      <div className="admin-stats-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="admin-stat-card">
          <div className="admin-stat-value">{schedule.entries.filter((e) => e.role_type === 'subject').length}/{schedule.weeklyLoadCap}</div>
          <div className="admin-stat-label">Periods this week</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value">{new Set(schedule.entries.map((e) => e.grade_level_name)).size}</div>
          <div className="admin-stat-label">Grade levels</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value">{new Set(schedule.entries.map((e) => e.section_name)).size}</div>
          <div className="admin-stat-label">Sections taught</div>
        </div>
      </div>

      <div className="card card-flush">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Grade &amp; Section</th><th>Subject</th><th>Days</th><th>Time</th><th>Room</th></tr></thead>
            <tbody>
              {schedule.entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.grade_level_name} &ndash; {e.section_name}</td>
                  <td>{e.subject_name || (e.role_type === 'adviser' ? 'Adviser (all subjects)' : '\u2014')}</td>
                  <td>{(e.days || []).map((d) => DAY_LABELS[d]).join('/')}</td>
                  <td>{e.role_type === 'adviser' ? 'All day' : `${e.start_time?.slice(0, 5)}\u2013${e.end_time?.slice(0, 5)}`}</td>
                  <td>{e.room || '\u2014'}</td>
                </tr>
              ))}
              {schedule.entries.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>No classes assigned yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
