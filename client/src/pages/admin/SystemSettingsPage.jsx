import { useEffect, useState } from 'react';
import {
  getSystemSettings, updateEnrollmentPeriod, updateRequiredDocuments,
  addRequiredDocument, renameRequiredDocument, removeRequiredDocument,
} from '../../api/admin';
import ConfirmDialog from '../../components/ConfirmDialog';

// The API sends timestamps; the form needs the school's calendar date (Manila),
// otherwise every save would move the window back by one day.
const manilaDate = (iso) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(iso)) : '');
// "October 20, 2026" — for reading, not for a date box.
const longDate = (iso) => (iso
  ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso))
  : '');

export default function SystemSettingsPage() {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState({ enrollmentOpen: false, opensAt: '', closesAt: '' });
  const [docs, setDocs] = useState([]);
  // The document list is also editable: a new one can be added, an existing
  // one renamed, and an unused one removed.
  const [newDoc, setNewDoc] = useState('');
  const [docError, setDocError] = useState('');
  const [editing, setEditing] = useState(null);   // { id, label }
  const [removing, setRemoving] = useState(null); // the document being removed
  const [saving, setSaving] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function load() {
    getSystemSettings().then((d) => {
      setData(d);
      setPeriod({
        enrollmentOpen: d.schoolYear.enrollment_open,
        opensAt: manilaDate(d.schoolYear.opens_at),
        closesAt: manilaDate(d.schoolYear.closes_at),
      });
      setDocs(d.requiredDocuments);
    }).catch((err) => setError(err.response?.data?.message || 'Could not load system settings.'));
  }
  useEffect(load, []);

  // Both saves change what every parent sees, so each asks first.
  const [confirming, setConfirming] = useState(null); // 'period' | 'docs'

  async function handleSavePeriod() {
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
          <form onSubmit={(e) => { e.preventDefault(); setConfirming('period'); }}>
            <div className="settings-row" style={{ borderTop: 'none' }}>
              <div>
                <b style={{ fontSize: 14.5 }}>Enrollment Portal</b>
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
            {/* The day enrollment actually stopped, which is not the closing
                date above when it was switched off early or filled up. */}
            {data.schoolYear.enrollment_closed_at && (
              <p className="hint" style={{ marginTop: 6 }}>
                Closed on <b>{longDate(data.schoolYear.enrollment_closed_at)}</b>. Turning the portal
                back on clears this.
              </p>
            )}
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
              <span className="muted" style={{ fontSize: 14 }}>
                {g.total_slots > 0
                  ? `${g.enrolled_count}/${g.total_slots} taken \u00b7 ${g.slots_left} left`
                  : 'No sections yet'}
                {g.waiting > 0 && ` \u00b7 ${g.waiting} approved, no section yet`}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Required Documents Configuration</h2>
        <p className="hint">
          Only the ticked documents are asked of parents and listed for walk-in enrollment.
          Unticked ones are not offered at all. Ticking is saved with the Save button; adding,
          renaming and removing take effect straight away.
        </p>
        {docError && <div className="alert alert-error">{docError}</div>}
        <div className="doc-list">
          {docs.map((d) => (
            <div key={d.id} className="doc-row">
              <label className="check-row" style={{ marginBottom: 0, flex: 1 }}>
                <input
                  type="checkbox" checked={d.is_required}
                  onChange={(e) => setDocs(docs.map((x) => (x.id === d.id ? { ...x, is_required: e.target.checked } : x)))}
                />
                <span>{d.label}</span>
              </label>
              <span className={`pill ${d.is_required ? 'pill-needs_revision' : 'pill-disabled'}`}>
                {d.is_required ? 'Requested' : 'Not requested'}
              </span>
              <button type="button" className="btn btn-sm btn-secondary"
                onClick={() => { setDocError(''); setEditing({ id: d.id, label: d.label }); }}>
                Rename
              </button>
              <button type="button" className="btn btn-sm btn-ghost"
                onClick={() => { setDocError(''); setRemoving(d); }}>
                Remove
              </button>
            </div>
          ))}
          {docs.length === 0 && <p className="hint">No documents are set up yet.</p>}
        </div>

        <div className="btn-row" style={{ marginTop: 12 }}>
          <input
            className="input" style={{ maxWidth: 320 }} maxLength={80}
            placeholder="Add another document, e.g. Barangay Clearance"
            aria-label="New document name"
            value={newDoc} onChange={(e) => { setNewDoc(e.target.value); setDocError(''); }}
          />
          <button type="button" className="btn btn-secondary" disabled={saving === 'add' || newDoc.trim().length < 3}
            onClick={async () => {
              setSaving('add'); setDocError(''); setMessage('');
              try {
                setDocs(await addRequiredDocument(newDoc));
                setNewDoc('');
                setMessage('Document added.');
              } catch (err) {
                setDocError(err.response?.data?.message || 'Could not add that document.');
              } finally { setSaving(''); }
            }}>
            {saving === 'add' ? 'Adding\u2026' : 'Add document'}
          </button>
        </div>

        <button className="btn btn-primary" onClick={() => setConfirming('docs')} disabled={saving === 'docs'} style={{ marginTop: 14 }}>
          {saving === 'docs' ? 'Saving...' : 'Save'}
        </button>
      </div>

      {editing && (
        <ConfirmDialog
          title="Rename this document"
          confirmLabel="Save name"
          busy={saving === 'rename'}
          disabled={editing.label.trim().length < 3}
          onClose={() => setEditing(null)}
          onConfirm={async () => {
            setSaving('rename'); setDocError('');
            try {
              setDocs(await renameRequiredDocument(editing.id, editing.label));
              setMessage('Document renamed.');
              setEditing(null);
            } catch (err) {
              setDocError(err.response?.data?.message || 'Could not rename that document.');
              setEditing(null);
            } finally { setSaving(''); }
          }}
        >
          <p>Parents see this name on their checklist and on the upload screen.</p>
          <input
            className="input" maxLength={80} autoFocus aria-label="Document name"
            value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })}
          />
        </ConfirmDialog>
      )}

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.label}?`}
          confirmLabel="Remove document"
          tone="danger"
          busy={saving === 'remove'}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            setSaving('remove'); setDocError('');
            try {
              setDocs(await removeRequiredDocument(removing.id));
              setMessage('Document removed.');
            } catch (err) {
              setDocError(err.response?.data?.message || 'Could not remove that document.');
            } finally { setSaving(''); setRemoving(null); }
          }}
        >
          <p>It stops being asked for and disappears from every checklist.</p>
          <p>
            A document learners have already submitted cannot be removed &mdash; untick it instead,
            so the records that mention it stay readable.
          </p>
        </ConfirmDialog>
      )}

      {confirming === 'period' && (
        <ConfirmDialog
          title="Save the enrollment period?"
          confirmLabel="Save period"
          busy={saving === 'period'}
          onConfirm={async () => { await handleSavePeriod(); setConfirming(null); }}
          onClose={() => setConfirming(null)}
        >
          <p>
            Enrollment will be <b>{period.enrollmentOpen ? 'open' : 'closed'}</b>, from{' '}
            <b>{period.opensAt || 'not set'}</b> to <b>{period.closesAt || 'not set'}</b>.
          </p>
          <p>Parents see this on the landing page at once, and the application form follows it.</p>
        </ConfirmDialog>
      )}

      {confirming === 'docs' && (
        <ConfirmDialog
          title="Save the required documents?"
          confirmLabel="Save documents"
          busy={saving === 'docs'}
          onConfirm={async () => { await handleSaveDocs(); setConfirming(null); }}
          onClose={() => setConfirming(null)}
        >
          <p>Parents and the walk-in desk will be asked for exactly these:</p>
          <ul>
            {docs.filter((d) => d.is_required).map((d) => <li key={d.id}>{d.label}</li>)}
          </ul>
          {docs.every((d) => !d.is_required) && <p>No document will be requested at all.</p>}
        </ConfirmDialog>
      )}
    </div>
  );
}
