import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';
import AppNav from '../components/AppNav';

const DOC_TYPES = {
  birth_certificate: 'Birth Certificate',
  form_138: 'Form 138 / Report Card',
  good_moral: 'Certificate of Good Moral Character',
};

export default function ApplicationDetail() {
  const { id } = useParams();
  const [app, setApp] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      const { data } = await api.get(`/applications/${id}`);
      setApp(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load application.');
    }
  }

  useEffect(() => { load(); }, [id]);

  async function upload(docType, file) {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('docType', docType);
    try {
      await api.post(`/applications/${id}/documents`, fd);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Upload failed.');
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

        {error && <div className="alert alert-error">{error}</div>}

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
            return (
              <div className="doc-row" key={key}>
                <div>
                  <div className="doc-name">{label}</div>
                  <div className="doc-sub">{doc ? `Uploaded ${new Date(doc.uploaded_at).toLocaleDateString()}` : 'Not yet uploaded'}</div>
                </div>
                {doc && app.status !== 'needs_revision'
                  ? <span className={`pill pill-${doc.status}`}>{doc.status}</span>
                  : <input className="input" style={{ maxWidth: 260 }} type="file"
                      accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => upload(key, e.target.files[0])} />}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}