import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';
import AppNav from '../components/AppNav';
import { useScrollToError } from '../hooks/useScrollToError';

// What the parent sees for each registrar decision on a document.
const DOC_STATUS_TEXT = {
  pending: 'Under review',
  verified: 'Verified',
  flagged: 'Needs attention',
  rejected: 'Rejected',
};

const DOC_TYPES = {
  birth_certificate: 'Birth Certificate',
  form_138: 'Form 138 / Report Card',
  good_moral: 'Certificate of Good Moral Character',
};

export default function ApplicationDetail() {
  const { id } = useParams();
  const [app, setApp] = useState(null);
  const [error, setError] = useState('');
  const [uploadError, setUploadError] = useState('');
  useScrollToError(error || uploadError);

  const [reloadKey, setReloadKey] = useState(0);
  const load = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let alive = true;
    api.get(`/applications/${id}`)
      .then(({ data }) => alive && setApp(data))
      .catch((err) => alive && setError(err.response?.data?.message || 'Could not load application.'));
    return () => { alive = false; };
  }, [id, reloadKey]);

  async function upload(docType, file) {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('docType', docType);
    setUploadError('');
    try {
      await api.post(`/applications/${id}/documents`, fd);
      load();
    } catch (err) {
      // A failed upload must not replace the whole page, so it has its own message.
      setUploadError(err.response?.data?.message || 'Upload failed.');
    }
  }

  const [lrn, setLrn] = useState('');
  const [lrnError, setLrnError] = useState('');
  const [lrnSaving, setLrnSaving] = useState(false);
  const [lrnSaved, setLrnSaved] = useState(false);

  async function saveLrn(e) {
    e.preventDefault();
    setLrnError('');
    if (!/^\d{12}$/.test(lrn.trim())) {
      setLrnError('LRN should be exactly 12 digits.');
      return;
    }
    setLrnSaving(true);
    try {
      await api.patch(`/students/${app.student_id}/lrn`, { lrn: lrn.trim() });
      setLrnSaved(true);
      load();
    } catch (err) {
      setLrnError(err.response?.data?.message || 'Could not save that LRN.');
    } finally {
      setLrnSaving(false);
    }
  }

  if (error) return <p style={{ color: 'red', padding: 24 }}>{error}</p>;
  if (!app) return <p style={{ padding: 24 }}>Loading...</p>;

  const uploaded = Object.fromEntries(app.documents.map((d) => [d.doc_type, d]));
  const reachedReview = !['draft', 'submitted'].includes(app.status);
  const finished = ['approved', 'rejected'].includes(app.status);

    return (
    <>
      <AppNav crumb={`${app.last_name}, ${app.first_name}`} />
      <div className="container container-narrow">
        <Link className="back-link" to="/dashboard">&larr; Back to dashboard</Link>
        <div className="page-head">
          <div>
            <h1>{app.last_name}, {app.first_name}</h1>
            <p>{app.grade_level} &middot; SY {app.school_year} &middot; Submitted {new Date(app.submitted_at).toLocaleDateString()}</p>
          </div>
          <span className={`pill pill-${app.status}`}>{app.status.replace('_', ' ')}</span>
        </div>

        {uploadError && <div className="alert alert-error" role="alert">{uploadError}</div>}

        <div className="card">
          <div className="timeline">
            <div className="tl-step done"><div className="tl-bar" /><div className="tl-label">Submitted</div></div>
            <div className={`tl-step ${reachedReview ? 'done' : ''}`}><div className="tl-bar" /><div className="tl-label">Under Review</div></div>
            <div className={`tl-step ${finished ? 'done' : app.status === 'needs_revision' ? 'current' : ''}`}>
              <div className="tl-bar" /><div className="tl-label">{finished ? app.status : 'Outcome'}</div>
            </div>
          </div>

          {app.section && <p className="muted">Assigned section: <b>{app.section}</b></p>}
          {app.remarks && <div className="alert alert-note"><b>Registrar remarks:</b> {app.remarks}</div>}

          <p className="section-label">Documents</p>
          {Object.entries(DOC_TYPES).map(([key, label]) => {
            const doc = uploaded[key];
            // Gated per document, not per application: a registrar can flag
            // or reject one specific file while the rest of the application
            // sits fine, so only a missing, flagged or rejected document
            // shows an upload control (a replacement for it).
            const needsUpload = !doc || ['rejected', 'flagged'].includes(doc.status);
            const rowClass = !doc ? 'doc-row-neutral'
              : doc.status === 'verified' ? 'doc-row-done'
              : doc.status === 'rejected' ? 'doc-row-rejected'
              : 'doc-row-pending';
            return (
              <div className={`doc-row ${rowClass}`} key={key}>
                <div>
                  <div className="doc-name">{label}</div>
                  <div className="doc-sub">{doc ? `Uploaded ${new Date(doc.uploaded_at).toLocaleDateString()}` : 'Not yet uploaded'}</div>
                </div>
                {doc && <span className={`pill pill-${doc.status}`}>{DOC_STATUS_TEXT[doc.status] || doc.status}</span>}
                {doc?.review_note && (
                  <div className="doc-note"><b>Registrar note:</b> {doc.review_note}</div>
                )}
                {needsUpload && (
                  <input className="input doc-upload" type="file" aria-label={`Upload ${label}`}
                    accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => upload(key, e.target.files[0])} />
                )}
              </div>
            );
          })}
        </div>

        {!app.has_lrn && (
          <div className="card">
            <h3>Learner Reference Number (LRN)</h3>
            {lrnSaved ? (
              <div className="alert alert-note">LRN saved.</div>
            ) : (
              <form onSubmit={saveLrn}>
                <p className="hint hint-spaced">
                  Not on file yet. If the school or DepEd has since assigned one, add it here so it carries
                  over automatically next school year.
                </p>
                <div className="field" style={{ maxWidth: 280 }}>
                  <input className={`input${lrnError ? ' input-error' : ''}`} value={lrn}
                    onChange={(e) => setLrn(e.target.value)} placeholder="12-digit LRN" maxLength={12} />
                  {lrnError && <p className="field-error">{lrnError}</p>}
                </div>
                <button className="btn btn-secondary" type="submit" disabled={lrnSaving}>
                  {lrnSaving ? 'Saving\u2026' : 'Save LRN'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </>
  );
}