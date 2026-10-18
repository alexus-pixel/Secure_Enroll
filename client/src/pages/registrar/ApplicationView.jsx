import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import api from '../../api/client';
import StatusBadge from '../../components/registrar/StatusBadge';
// Loaded only when a registrar opens a document, so the PDF engine is never
// downloaded for parents or for pages that don't need it.
const DocumentViewer = lazy(() => import('../../components/registrar/DocumentViewer'));
import { DocStatusBadge, ViewerActions } from '../../components/registrar/DocActions';

const fmt = (d) =>
  new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });

const FINAL = ['approved', 'rejected'];

export default function ApplicationView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const outlet = useOutletContext();
  const setCrumb = outlet?.setCrumb;

  const [app, setApp] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [remarks, setRemarks] = useState('');
  const [notice, setNotice] = useState(null); // { type: 'ok' | 'error', text }
  const [viewing, setViewing] = useState(null); // document type being viewed
  const [deciding, setDeciding] = useState(false);
  // The section list shown after Approve (or for an approved learner with no section yet).
  const [picker, setPicker] = useState(null);   // { mode: 'approve' | 'assign', sections: [...] }
  const [pickedSection, setPickedSection] = useState('');

  const [reloadKey, setReloadKey] = useState(0);
  const load = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let alive = true;
    api.get(`/registrar/applications/${id}`)
      .then(({ data }) => {
        if (!alive) return;
        setApp(data);
        setRemarks((r) => r || data.remarks || '');
        setLoadError('');
      })
      .catch((err) => {
        if (alive) setLoadError(err.response?.data?.message || 'Could not load this application.');
      });
    return () => { alive = false; };
  }, [id, reloadKey]);

  useEffect(() => { if (app && setCrumb) setCrumb(app.student); }, [app, setCrumb]);

  if (loadError) {
    return (
      <div className="reg-page reg-narrow">
        <button className="reg-back" onClick={() => navigate(-1)}>&lsaquo; Go Back</button>
        <div className="reg-notice reg-notice-error">{loadError}</div>
      </div>
    );
  }
  if (!app) return <div className="reg-page"><p>Loading&hellip;</p></div>;

  const finalized = FINAL.includes(app.status);
  // After a revision request nothing can be decided until the parent resubmits.
  const awaitingParent = app.status === 'needs_revision';
  const locked = finalized || awaitingParent;
  const docs = app.documents;
  const viewingDoc = docs.find((d) => d.type === viewing);
  // A decision needs every file on record reviewed and the grade qualification marked.
  const toReview = docs.filter((d) => (d.hasFile || d.receivedInPerson) && d.status === 'pending');
  const qualificationMarked = Boolean(app.gradeQualification);
  const reviewDone = toReview.length === 0 && qualificationMarked;
  const problemDocs = docs.filter((d) => d.status === 'flagged' || d.status === 'rejected');

  // Verify, flag or reject one document. Throws on failure so the
  // dialog or viewer that called it can show the error.
  // Why the viewer's Verify / Flag / Reject are off, or '' when they are on.
  function viewerLock(doc) {
    if (finalized) return 'This application is finalized.';
    if (awaitingParent) return 'Waiting for the parent to resubmit.';
    if (['verified', 'flagged', 'rejected'].includes(doc.status)) {
      return 'Already reviewed. This opens again when the parent uploads a new copy.';
    }
    return '';
  }

  async function setDocStatus(type, status, note) {
    await api.patch(`/registrar/applications/${id}/documents/${type}`, { status, note });
    setNotice(null);
    load();
  }

  async function setQualification(value) {
    try {
      await api.patch(`/registrar/applications/${id}/qualification`, { value });
      setNotice(null);
      load();
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.message || 'Could not save that.' });
    }
  }

  // Approve first asks which section the learner joins (sections of the grade the parent chose).
  async function openSectionPicker(mode) {
    setNotice(null);
    try {
      const { data } = await api.get(`/registrar/applications/${id}/sections`);
      if (mode === 'approve' && data.sections.length === 0) {
        // The school has not set up sections for this grade, so there is nothing to choose.
        return decide('approve', 'Application approved.');
      }
      setPickedSection('');
      setPicker({ mode, sections: data.sections });
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.message || 'Could not load the sections.' });
    }
  }

  async function confirmSection() {
    if (!pickedSection) return;
    if (picker.mode === 'approve') {
      await decide('approve', 'Application approved and the learner is enrolled in the chosen section.', Number(pickedSection));
      return;
    }
    setDeciding(true);
    try {
      await api.post(`/registrar/applications/${id}/section`, { sectionId: Number(pickedSection) });
      setNotice({ type: 'ok', text: 'The learner is now enrolled in the chosen section.' });
      setPicker(null);
      load();
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.message || 'Could not save the section.' });
      openSectionPicker('assign');
    } finally {
      setDeciding(false);
    }
  }

  async function decide(action, okText, sectionId) {
    if (action !== 'approve' && !remarks.trim()) {
      setNotice({
        type: 'error',
        text: action === 'revision'
          ? 'Add a remark explaining what needs to be revised.'
          : 'Add a remark explaining the reason for rejection.',
      });
      return;
    }
    setDeciding(true);
    try {
      await api.post(`/registrar/applications/${id}/decision`, { action, remarks, sectionId });
      setNotice({ type: 'ok', text: okText });
      setPicker(null);
      load();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.message || 'Could not save the decision.' });
    } finally {
      setDeciding(false);
    }
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
        {app.grade} &middot; Guardian: {app.guardian} &middot; Submitted {fmt(app.submitted)}{' '}
        <StatusBadge status={app.status} />
      </p>

      {app.missingLrn && (
        <div className="reg-banner">This student has no LRN on file yet. You can enter it under Missing LRN.</div>
      )}
      {notice && <div className={`reg-notice reg-notice-${notice.type}`} role="status">{notice.text}</div>}
      {finalized && (
        <div className="reg-notice reg-notice-ok">
          This application is {app.status}. Documents can no longer be changed.
        </div>
      )}
      {awaitingParent && (
        <div className="reg-notice reg-notice-ok">
          A revision was requested. Review opens again when the parent resubmits their documents.
        </div>
      )}

      <div className="reg-card">
        <p className="reg-card-label">Documents</p>
        {docs.map((d) => {
          const hasFile = d.hasFile;
          return (
            <div className={`reg-item is-${d.status}`} key={d.type}>
              <div className="reg-item-main">
                <div className="reg-item-name">
                  {d.name}
                  <DocStatusBadge doc={d} />
                  {d.receivedInPerson && <span className="reg-badge reg-badge-paper">Paper copy received</span>}
                </div>
                <div className="reg-item-meta">
                  {d.status === 'awaiting' && 'Not yet uploaded by the parent.'}
                  {d.status !== 'awaiting' && hasFile && `Uploaded ${fmt(d.uploaded)}`}
                  {d.status !== 'awaiting' && !hasFile && d.receivedInPerson && 'Handed in at the front desk. There is no digital file to view.'}
                </div>
                {d.note && <div className="reg-item-note"><b>Reason:</b> {d.note}</div>}
              </div>

              {d.status !== 'awaiting' && (hasFile || d.receivedInPerson) && (
                <div className="reg-item-actions">
                  {/* Verify, Flag and Reject live inside the viewer, so a document
                      is only judged after it has been opened. */}
                  <button className="reg-btn reg-btn-sm reg-btn-view" onClick={() => setViewing(d.type)}>
                    View
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="reg-card">
        <p className="reg-card-label">Requirements</p>
        <div className="reg-item">
          <div className="reg-item-main">
            <div className="reg-item-name">Grade Qualification</div>
            <div className="reg-item-meta">Minimum average required for {app.grade} admission</div>
          </div>
          <div className="reg-item-actions">
            <button className={`reg-btn reg-btn-sm reg-btn-green${app.gradeQualification === 'met' ? ' on' : ''}`}
              disabled={locked} onClick={() => setQualification('met')}>
              Met
            </button>
            <button className={`reg-btn reg-btn-sm reg-btn-red${app.gradeQualification === 'not_met' ? ' on' : ''}`}
              disabled={locked} onClick={() => setQualification('not_met')}>
              Not Met
            </button>
          </div>
        </div>
      </div>

      <div className="reg-card">
        <p className="reg-card-title">Registrar Remarks</p>
        <textarea className="reg-textarea" value={remarks} disabled={locked}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Add remarks for the parent or for your records..." />
      </div>

      {picker && (
        <div className="reg-card" id="section-picker">
          <p className="reg-card-title">
            {picker.mode === 'approve' ? 'Choose a section to approve this learner' : 'Choose a section for this learner'}
          </p>
          <p className="reg-help">Sections of {app.grade}, the grade the parent applied for. The learner is enrolled in the one you pick.</p>
          {picker.sections.map((s) => (
            <label key={s.id} className={`reg-section-opt${s.slotsLeft <= 0 ? ' is-full' : ''}`}>
              <input type="radio" name="section" value={s.id} disabled={s.slotsLeft <= 0}
                checked={String(pickedSection) === String(s.id)} onChange={() => setPickedSection(String(s.id))} />
              <span className="reg-section-name">{s.name}</span>
              <span className="reg-section-left">
                {s.slotsLeft <= 0 ? 'Full' : `${s.slotsLeft} ${s.slotsLeft === 1 ? 'slot' : 'slots'} left`}
                <span className="reg-section-sub"> ({s.enrolled}/{s.capacity} enrolled)</span>
              </span>
            </label>
          ))}
          {picker.sections.length > 0 && picker.sections.every((s) => s.slotsLeft <= 0) && (
            <p className="reg-help" style={{ color: 'var(--danger)' }}>
              Every section of {app.grade} is full. Ask the administrator to add slots or a section in School Settings.
            </p>
          )}
          <div className="reg-actions" style={{ marginTop: 10 }}>
            <button className="reg-btn reg-btn-blue" disabled={!pickedSection || deciding} onClick={confirmSection}>
              {picker.mode === 'approve' ? 'Confirm approval' : 'Enrol in this section'}
            </button>
            <button className="reg-btn" disabled={deciding} onClick={() => setPicker(null)}>Cancel</button>
          </div>
        </div>
      )}

      {app.status === 'approved' && (
        <div className="reg-card">
          <p className="reg-card-title">Section</p>
          {app.section
            ? <p>Enrolled in <b>{app.section}</b>.</p>
            : (
              <>
                <p className="reg-help">Approved, but no section has been chosen yet.</p>
                {!picker && <button className="reg-btn reg-btn-blue" onClick={() => openSectionPicker('assign')}>Choose a section</button>}
              </>
            )}
        </div>
      )}

      <div className="reg-actions">
        <button className="reg-btn reg-btn-blue" disabled={locked || deciding || !reviewDone || problemDocs.length > 0}
          title={!reviewDone ? 'Review every document and the grade qualification first' : problemDocs.length ? 'Resolve flagged or rejected documents first' : undefined}
          onClick={() => openSectionPicker('approve')}>
          Approve Application
        </button>
        <button className="reg-btn reg-btn-orange" disabled={locked || deciding || !reviewDone}
          title={!reviewDone ? 'Review every document and the grade qualification first' : undefined}
          onClick={() => decide('revision', 'Revision requested. The parent will see your remarks and any flagged documents.')}>
          Request Revision
        </button>
        <button className="reg-btn reg-btn-red" disabled={locked || deciding || !reviewDone}
          title={!reviewDone ? 'Review every document and the grade qualification first' : undefined}
          onClick={() => decide('reject', 'Application rejected.')}>
          Reject Application
        </button>
      </div>

      {!reviewDone && !locked && (
        <p className="reg-help" role="status">
          The decision buttons turn on once every document has been verified, flagged or rejected
          {toReview.length > 0 && ` (still to review: ${toReview.map((d) => d.name).join(', ')})`}
          {!qualificationMarked && (toReview.length > 0 ? ' and the grade qualification is marked' : ', and the grade qualification is marked')}.
        </p>
      )}
      {reviewDone && problemDocs.length > 0 && !locked && (
        <p className="reg-help" role="status" style={{ color: 'var(--danger)' }}>
          Approve is turned off while a document is flagged or rejected: {problemDocs.map((d) => d.name).join(', ')}.
          Ask the parent for a new copy with Request Revision. Approval opens again once it is replaced and verified.
        </p>
      )}

      {viewingDoc && (
        <Suspense fallback={<div className="dv-overlay"><div className="dv-state">Opening viewer&hellip;</div></div>}>
        <DocumentViewer
          key={viewingDoc.type + (viewingDoc.docId || '')}
          title={viewingDoc.name}
          subtitle={`${app.student} · ${app.grade}`}
          badge={<DocStatusBadge doc={viewingDoc} />}
          fileUrl={viewingDoc.hasFile ? `/registrar/applications/${id}/documents/${viewingDoc.type}/file` : null}
          onClose={() => setViewing(null)}
          footer={(
            <ViewerActions
              doc={viewingDoc}
              lockedMessage={viewerLock(viewingDoc)}
              onAction={async (status, note) => {
                await setDocStatus(viewingDoc.type, status, note);
                setViewing(null);
              }}
            />
          )}
        />
        </Suspense>
      )}

    </div>
  );
}