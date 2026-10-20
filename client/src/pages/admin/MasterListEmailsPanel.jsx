import { useEffect, useState } from 'react';
import api from '../../api/client';
import Pagination, { usePagination } from '../../components/Pagination';

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '');

const STATUS = {
  sent: { cls: 'pill-approved', text: 'Sent' },
  failed: { cls: 'pill-rejected', text: 'Failed' },
  skipped: { cls: 'pill-pending', text: 'Not sent' },
};

// Each section's master list (plus the adviser's schedule) goes to the adviser
// by email, automatically once enrollment closes. This panel shows what was
// sent and lets an administrator send a list again by hand.
export default function MasterListEmailsPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);       // section id, 'all' or 'auto'
  const [notice, setNotice] = useState('');

  const load = () => api.get('/admin/reports/master-list-emails')
    .then(({ data: d }) => { setData(d); setError(''); })
    .catch((err) => setError(err.response?.data?.message || 'Could not load the master list emails.'));
  useEffect(() => { load(); }, []);

  async function send(sectionId) {
    setBusy(sectionId || 'all'); setNotice(''); setError('');
    try {
      const { data: r } = await api.post('/admin/reports/master-list-emails/send', sectionId ? { sectionId } : {});
      const sent = r.results.filter((x) => x.status === 'sent').length;
      const problems = r.results.filter((x) => x.status !== 'sent');
      setNotice(sent ? `Sent ${sent} ${sent === 1 ? 'email' : 'emails'}.` : 'Nothing was sent.');
      if (problems.length) setError(problems.map((p) => p.message).join(' '));
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not send the emails.');
    } finally { setBusy(null); }
  }

  async function toggleAuto(auto) {
    setBusy('auto'); setNotice(''); setError('');
    try {
      await api.patch('/admin/reports/master-list-emails/auto', { auto });
      setData((d) => ({ ...d, auto }));
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save that setting.');
    } finally { setBusy(null); }
  }

  const pager = usePagination(data?.sections);

  if (!data) return error ? <div className="card"><p className="field-error">{error}</p></div> : null;

  return (
    <div className="card" id="master-list-emails" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <strong>Master list emails</strong>
          <p className="cell-sub" style={{ marginTop: 4 }}>
            Each section&rsquo;s master list and its adviser&rsquo;s weekly schedule are emailed to the adviser as two PDFs
            when enrollment closes (School Year {data.schoolYear}).
          </p>
        </div>
        <button className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => send(null)}>
          {busy === 'all' ? 'Sending…' : 'Send all now'}
        </button>
      </div>

      <label className="check-row" style={{ margin: '12px 0' }}>
        <input type="checkbox" checked={data.auto} disabled={busy === 'auto'} onChange={(e) => toggleAuto(e.target.checked)} />
        Send automatically when enrollment closes
        {data.auto && data.enrollmentState !== 'closed' && <span className="muted" style={{ fontSize: 13.5 }}> (enrollment is not closed yet)</span>}
      </label>

      {!data.emailConfigured && (
        <div className="alert alert-error" role="alert">
          Email is not set up on the server, so nothing can be sent yet. Add the SMTP settings to the server&rsquo;s .env file.
        </div>
      )}
      {notice && <div className="alert alert-note" role="status">{notice}</div>}
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table className="data">
          <thead><tr><th>Section</th><th>Learners</th><th>Adviser</th><th>Last email</th><th></th></tr></thead>
          <tbody>
            {pager.total === 0 && <tr><td colSpan={5} className="muted">No sections have been set up yet.</td></tr>}
            {pager.pageRows.map((s) => {
              const st = s.lastStatus ? STATUS[s.lastStatus] : null;
              return (
                <tr key={s.sectionId}>
                  <td>{s.gradeLevel} &ndash; {s.section}</td>
                  <td>{s.studentCount}</td>
                  <td>
                    {s.recipient ? (
                      <>
                        {s.recipient.name}
                        {!s.recipient.isAdviser && <span className="muted" style={{ fontSize: 12.5 }}> (teacher, no adviser set)</span>}
                        <div className="cell-sub">{s.recipient.email}</div>
                      </>
                    ) : <span className="muted">No teacher assigned</span>}
                  </td>
                  <td>
                    {st ? <span className={`pill ${st.cls}`}>{st.text}</span> : <span className="muted">Not sent yet</span>}
                    {s.lastAt && <div className="cell-sub">{when(s.lastAt)}{s.lastTrigger === 'auto' ? ' · automatic' : ''}</div>}
                    {s.lastError && s.lastStatus !== 'sent' && <div className="cell-sub" style={{ color: 'var(--danger)' }}>{s.lastError}</div>}
                  </td>
                  <td>
                    <button className="link-action" disabled={busy !== null || s.studentCount === 0 || !s.recipient}
                      title={s.studentCount === 0 ? 'No enrolled learners yet' : !s.recipient ? 'Assign a teacher in Class Schedules' : ''}
                      onClick={() => send(s.sectionId)}>
                      {busy === s.sectionId ? 'Sending…' : s.lastSentAt ? 'Send again' : 'Send now'}
                    </button>
                  </td>
                </tr>
              );
            })}
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
        label="sections"
      />
    </div>
  );
}
