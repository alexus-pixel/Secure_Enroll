import { useEffect, useState } from 'react';
import { getSystemSettings, updateEnrollmentPeriod, updateRequiredDocuments } from '../../api/admin';

export default function SystemSettingsPage() {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState({ enrollmentOpen: false, opensAt: '', closesAt: '' });
  const [docs, setDocs] = useState([]);
  const [saving, setSaving] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function load() {
    getSystemSettings().then((d) => {
      setData(d);
      setPeriod({
        enrollmentOpen: d.schoolYear.enrollment_open,
        opensAt: d.schoolYear.opens_at?.slice(0, 10),
        closesAt: d.schoolYear.closes_at?.slice(0, 10),
      });
      setDocs(d.requiredDocuments);
    }).catch((err) => setError(err.response?.data?.message || 'Could not load system settings.'));
  }
  useEffect(load, []);

  async function handleSavePeriod(e) {
    e.preventDefault();
    setSaving('period'); setMessage(''); setError('');
    try {
      await updateEnrollmentPeriod(period);
      setMessage('Enrollment period saved.');
      load();
    } catch (err) {
      setError(err.response?.data?.errors?.map((x) => x.message).join(' ') || err.response?.data?.message || 'Could not save.');
    } finally {
      setSaving('');
    }
  }

  async function handleSaveDocs() {
    setSaving('docs'); setMessage(''); setError('');
    try {
      await updateRequiredDocuments(docs.map((d) => ({ id: d.id, isRequired: d.is_required })));
      setMessage('Required documents saved.');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save.');
    } finally {
      setSaving('');
    }
  }

  if (!data) return error ? <div className="alert alert-error">{error}</div> : <div className="empty-state">Loading...</div>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>System Settings</h1>
          <p>Configure the enrollment period, grade capacity, and required documents.</p>
        </div>
      </div>

      {message && <div className="alert" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="settings-grid">
        <div className="card">
          <h2>Enrollment Period</h2>
          <form onSubmit={handleSavePeriod}>
            <div className="settings-row" style={{ borderTop: 'none' }}>
              <div>
                <b style={{ fontSize: 13 }}>Enrollment Portal</b>
                <div className="cell-sub">Allow new applications to be submitted.</div>
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox" checked={period.enrollmentOpen}
                  onChange={(e) => setPeriod({ ...period, enrollmentOpen: e.target.checked })}
                  style={{ width: 18, height: 18 }}
                />
              </label>
            </div>
            <div className="field-grid cols-2" style={{ marginTop: 14 }}>
              <div><label className="label">Enrollment opens</label>
                <input className="input" type="date" value={period.opensAt} onChange={(e) => setPeriod({ ...period, opensAt: e.target.value })} required /></div>
              <div><label className="label">Enrollment closes</label>
                <input className="input" type="date" value={period.closesAt} onChange={(e) => setPeriod({ ...period, closesAt: e.target.value })} required /></div>
            </div>
            <div className="field"><label className="label">School year</label>
              <input className="input" value={data.schoolYear.label} disabled />
              <p className="hint">Managed from School Settings.</p>
            </div>
            <button className="btn btn-primary" type="submit" disabled={saving === 'period'}>
              {saving === 'period' ? 'Saving...' : 'Save Period Settings'}
            </button>
          </form>
        </div>

        <div className="card">
          <h2>Grade Level Configuration</h2>
          <p className="hint" style={{ marginTop: -8 }}>Slots are based on the sections set up for each grade level (School Settings &rarr; Manage).</p>
          {data.gradeLevels.map((g) => (
            <div key={g.id} className="settings-row">
              <span>{g.name}</span>
              <span className="muted" style={{ fontSize: 12.5 }}>{g.enrolled_count}/{g.total_slots} slots</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Required Documents Configuration</h2>
        <p className="hint" style={{ marginTop: -8 }}>Applies to every new application.</p>
        <div className="field-grid cols-2">
          {docs.map((d) => (
            <label key={d.id} className="check-row">
              <input
                type="checkbox" checked={d.is_required}
                onChange={(e) => setDocs(docs.map((x) => (x.id === d.id ? { ...x, is_required: e.target.checked } : x)))}
              />
              {d.label}
              <span className={`pill ${d.is_required ? 'pill-needs_revision' : 'pill-disabled'}`} style={{ marginLeft: 'auto' }}>
                {d.is_required ? 'Required' : 'Optional'}
              </span>
            </label>
          ))}
        </div>
        <button className="btn btn-primary" onClick={handleSaveDocs} disabled={saving === 'docs'} style={{ marginTop: 10 }}>
          {saving === 'docs' ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
