import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { mockApplications } from '../../data/mockApplications';

const INITIAL_DOCS = [
  { id: 'birth', name: 'Birth Certificate', file: 'birth_cert2989.jpg', uploaded: '9/4/2026', status: 'pending' },
  { id: 'form138', name: 'Form 138 / Report Card', file: 'report.jpg', uploaded: '9/4/2026', status: 'pending' },
  { id: 'moral', name: 'Certificate of Good Moral', file: null, uploaded: null, status: 'awaiting' },
];

export default function ApplicationView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const app = mockApplications.find((a) => String(a.id) === id);

  const [docs, setDocs] = useState(INITIAL_DOCS);
  const [grade, setGrade] = useState(null); // 'met' | 'not_met' | null
  const [remarks, setRemarks] = useState('');
  const [notice, setNotice] = useState(null); // { type: 'ok' | 'error', text }

  if (!app) return <p>Application not found.</p>;

  function setDocStatus(docId, status) {
    setDocs((list) => list.map((d) => (d.id === docId ? { ...d, status } : d)));
  }

  function handleApprove() {
    const allVerified = docs.every((d) => d.status === 'verified');
    if (!allVerified || grade !== 'met') {
      setNotice({ type: 'error', text: 'Verify all documents and mark the grade qualification as Met before approving.' });
      return;
    }
    // TODO: call API
    setNotice({ type: 'ok', text: 'Application approved.' });
  }

  function handleRevision() {
    if (!remarks.trim()) {
      setNotice({ type: 'error', text: 'Add a remark explaining what needs to be revised.' });
      return;
    }
    // TODO: call API
    setNotice({ type: 'ok', text: 'Revision requested. The parent will be notified.' });
  }

  function handleReject() {
    if (!remarks.trim()) {
      setNotice({ type: 'error', text: 'Add a remark explaining the reason for rejection.' });
      return;
    }
    // TODO: call API
    setNotice({ type: 'ok', text: 'Application rejected.' });
  }

  return (
    <div className="reg-page reg-narrow">
      <button className="reg-back" onClick={() => navigate(-1)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Go Back
      </button>

      <h1 className="reg-title">{app.student}</h1>
      <p className="reg-subtitle">
        {app.grade} - Guardian: {app.guardian} - Submitted {app.submitted}
      </p>

      {notice && <div className={`reg-notice reg-notice-${notice.type}`}>{notice.text}</div>}

      <div className="reg-card">
        <p className="reg-card-label">Documents</p>
        {docs.map((d) => (
          <div className="reg-item" key={d.id}>
            <div>
              <div className="reg-item-name">{d.name}</div>
              <div className="reg-item-meta">
                {d.file ? `Uploaded ${d.uploaded} - ${d.file}` : 'Not yet uploaded'}
                {d.status === 'verified' && ' · ✓ Verified'}
                {d.status === 'flagged' && ' · ⚑ Flagged'}
              </div>
            </div>
            {d.status === 'awaiting' ? (
              <span className="reg-badge reg-badge-under_review">Awaiting Parent</span>
            ) : (
              <div className="reg-item-actions">
                <button
                  className={`reg-btn reg-btn-green ${d.status === 'flagged' ? 'dim' : ''}`}
                  onClick={() => setDocStatus(d.id, 'verified')}
                >
                  Verify
                </button>
                <button
                  className={`reg-btn reg-btn-red ${d.status === 'flagged' ? 'on' : ''}`}
                  onClick={() => setDocStatus(d.id, 'flagged')}
                >
                  Flag
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="reg-card">
        <p className="reg-card-label">Requirements</p>
        <div className="reg-item">
          <div>
            <div className="reg-item-name">Grade Qualification</div>
            <div className="reg-item-meta">Minimum average required for {app.grade} admission</div>
          </div>
          <div className="reg-item-actions">
            <button
              className={`reg-btn reg-btn-green ${grade === 'not_met' ? 'dim' : ''}`}
              onClick={() => setGrade('met')}
            >
              Met
            </button>
            <button
              className={`reg-btn reg-btn-red ${grade === 'not_met' ? 'on' : ''}`}
              onClick={() => setGrade('not_met')}
            >
              Not Met
            </button>
          </div>
        </div>
      </div>

      <div className="reg-card">
        <p className="reg-card-title">Registrar Remarks</p>
        <textarea
          className="reg-textarea"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Add remarks for the parent or for your records..."
        />
      </div>

      <div className="reg-actions">
        <button className="reg-btn reg-btn-blue" onClick={handleApprove}>Approve Application</button>
        <button className="reg-btn reg-btn-orange" onClick={handleRevision}>Request Revision</button>
        <button className="reg-btn reg-btn-red" onClick={handleReject}>Reject</button>
      </div>
    </div>
  );
}