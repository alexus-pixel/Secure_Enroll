import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import api from '../../api/client';
import StatusBadge from '../../components/registrar/StatusBadge';
import LrnEntry from '../../components/registrar/LrnEntry';
// Loaded only when a registrar opens a document, so the PDF engine is never
// downloaded for parents or for pages that don't need it.
const DocumentViewer = lazy(() => import('../../components/registrar/DocumentViewer'));
import { DocStatusBadge, ViewerActions } from '../../components/registrar/DocActions';

const fmt = (d) =>
  new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });

const FINAL = ['approved', 'rejected'];

/**
 * The remarks the parent is sent when an application is returned, written
 * from the documents that were actually rejected.
 *
 * The registrar already said what was wrong with each file while looking at
 * it; retyping that into a remarks box was the same sentence a second time,
 * so it is assembled here instead. It stays editable: a case the per-document
 * notes do not cover is still the registrar's to explain.
 */
function remarksForRejected(docs) {
  const bad = docs.filter((d) => d.status === 'rejected');
  if (bad.length === 0) return '';
  const lines = bad.map((d) => (d.note && d.note.trim()
    ? `\u2022 ${d.name}: ${d.note.trim()}`
    : `\u2022 ${d.name}: the copy on file could not be accepted. Please send a clear, complete and readable photo or scan.`));
  const count = bad.length === 1 ? 'One of the documents' : `${bad.length} of the documents`;
  return `${count} sent with this application cannot be accepted yet:\n\n${lines.join('\n')}\n\n`
    + 'Please upload a new copy of the document'
    + (bad.length === 1 ? '' : 's')
    + ' listed above and submit again. Everything else on file has already been verified.';
}

export default function ApplicationView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const outlet = useOutletContext();
  const setCrumb = outlet?.setCrumb;

  const [app, setApp] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [remarks, setRemarks] = useState('');
  const [notice, setNotice] = useState(null); // { type: 'ok' | 'error', text }
  // "This LRN is not correct" — the note the parent will see, and its state.
  const [flagging, setFlagging] = useState(false);
  const [flagNote, setFlagNote] = useState('');
  const [flagSaving, setFlagSaving] = useState(false);
  const [viewing, setViewing] = useState(null); // document type being viewed
  const [deciding, setDeciding] = useState(false);
  // The remarks dialog shown when the application is returned to the parent.
  const [rejecting, setRejecting] = useState(false);
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
  // Somebody else opened this application first. Everything on the page still
  // reads normally; nothing on it can be decided.
  const heldBy = app.review && app.review.mine === false ? app.review.heldBy : null;
  const locked = finalized || awaitingParent || Boolean(heldBy);
  const docs = app.documents;
  const viewingDoc = docs.find((d) => d.type === viewing);
  // A decision needs every file on record reviewed and the grade qualification
  // marked. Kinder is the entry grade: there are no previous grades to qualify
  // with, so that step does not exist for it at all.
  const toReview = docs.filter((d) => (d.hasFile || d.receivedInPerson) && d.status === 'pending');
  const needsQualification = app.requiresQualification !== false;
  const qualificationMarked = !needsQualification || Boolean(app.gradeQualification);
  const reviewDone = toReview.length === 0 && qualificationMarked;
  const problemDocs = docs.filter((d) => d.status === 'flagged' || d.status === 'rejected');

  // Approve is on only when the review is finished and nothing was rejected.
  // Reject is on only when something was, because the parent cannot be asked
  // to fix a document nobody marked as wrong.
  const canApprove = reviewDone && problemDocs.length === 0;
  // Returning the application needs only one rejected document. It does not
  // wait for the rest of the review, because the grade qualification is
  // judged from the report card and cannot be marked when that is the file
  // being sent back.
  const canReject = problemDocs.length > 0 && !locked;
  const approveBlocked = (() => {
    if (canApprove) return '';
    // A rejected document is the whole story: approval is off and returning
    // the application is what to do next, whatever else is still unreviewed.
    if (problemDocs.length > 0) {
      return `Approval is off while ${problemDocs.map((d) => d.name).join(', ')} `
        + `${problemDocs.length === 1 ? 'is' : 'are'} rejected. Reject the application to ask the parent for a new copy; `
        + 'approval opens again once it is replaced and verified.';
    }
    const waiting = [];
    if (toReview.length > 0) waiting.push(`review ${toReview.map((d) => d.name).join(', ')}`);
    if (needsQualification && !app.gradeQualification) waiting.push('mark the grade qualification');
    return waiting.length ? `Still to do before a decision: ${waiting.join(', and ')}.` : '';
  })();

  // Verify, flag or reject one document. Throws on failure so the
  // dialog or viewer that called it can show the error.
  // Why the viewer's Verify / Flag / Reject are off, or '' when they are on.
  function viewerLock(doc) {
    if (heldBy) return `Under review by ${heldBy.name} (${heldBy.role}).`;
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

  // Tell the parent the LRN on file is wrong, and clear it.
  async function flagLrn() {
    setFlagSaving(true);
    try {
      await api.post(`/registrar/students/${app.studentId}/lrn-flag`, { note: flagNote.trim() });
      setFlagging(false);
      setNotice({ type: 'ok', text: 'The LRN was cleared and the parent has been asked for the correct one.' });
      load();
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.message || 'Could not flag that LRN.' });
    } finally {
      setFlagSaving(false);
    }
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
      setNotice({ type: 'error', text: 'Add a remark explaining what the parent has to replace.' });
      return;
    }
    setDeciding(true);
    try {
      await api.post(`/registrar/applications/${id}/decision`, { action, remarks, sectionId });
      setNotice({ type: 'ok', text: okText });
      setPicker(null);
      setRejecting(false);
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

      {/* A new learner's LRN is not asked of the parent. The registrar reads it
          from the submitted documents (for example the report card) or the DepEd
          LIS and records it here, during review. */}
      {app.missingLrn && (
        <div className="reg-card">
          <p className="reg-card-label">Learner Reference Number</p>
          <div className="reg-item-meta" style={{ marginBottom: 8 }}>
            {app.lrnFlaggedAt
              ? 'The previous LRN was flagged and removed. Enter the correct 12-digit LRN from the report card or the DepEd LIS.'
              : 'No LRN is on file yet. Read it from the submitted documents (for example the report card) or the DepEd LIS and enter it here.'}
          </div>
          <LrnEntry studentId={app.studentId} onSaved={() => { setNotice({ type: 'ok', text: 'The LRN was saved.' }); load(); }} />
        </div>
      )}
      {app.lrnFlaggedAt && (
        <div className="reg-banner reg-banner-warn">
          The LRN for this learner was flagged as incorrect on {fmt(app.lrnFlaggedAt)} and removed.
          The parent has been asked to send the right one.
          {app.lrnFlagNote && <div style={{ marginTop: 4 }}><b>Reason:</b> {app.lrnFlagNote}</div>}
        </div>
      )}

      {/* "I cannot find this LRN in the LIS." Clears the wrong number and asks
          the parent for the correct one. */}
      {!app.missingLrn && !finalized && (
        <div className="reg-card">
          <p className="reg-card-label">Learner Reference Number</p>
          {!flagging ? (
            <div className="reg-item">
              <div className="reg-item-main">
                <div className="reg-item-name">An LRN is on file for this learner</div>
                <div className="reg-item-meta">
                  If you cannot find it in the DepEd LIS, flag it: the number is removed and the parent is
                  asked to send the correct one.
                </div>
              </div>
              <div className="reg-item-actions">
                <button type="button" className="reg-btn reg-btn-sm reg-btn-orange" onClick={() => { setFlagging(true); setFlagNote(''); }}>
                  LRN not correct
                </button>
              </div>
            </div>
          ) : (
            <div>
              <label className="reg-label" htmlFor="lrn-flag-note">
                What is wrong with it? The parent sees this note.
              </label>
              <textarea id="lrn-flag-note" className="reg-textarea" value={flagNote}
                onChange={(e) => setFlagNote(e.target.value)}
                placeholder="e.g. This LRN is not found in the DepEd LIS for this learner." />
              <div className="reg-actions" style={{ marginTop: 8 }}>
                <button type="button" className="reg-btn reg-btn-orange" disabled={flagSaving || flagNote.trim().split(/\s+/).filter(Boolean).length < 3}
                  onClick={flagLrn}>
                  {flagSaving ? 'Saving…' : 'Flag this LRN and notify the parent'}
                </button>
                <button type="button" className="reg-btn" onClick={() => setFlagging(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
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

      {needsQualification && (
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
      )}

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

      {/* One reviewer at a time. Whoever opened it first keeps it until they
          are finished or ten minutes pass with the page closed. */}
      {heldBy && (
        <div className="reg-card" role="status" style={{ borderColor: 'var(--warn, #c08a2e)' }}>
          <p className="reg-card-title" style={{ margin: 0 }}>
            Under review by {heldBy.name} ({heldBy.role})
          </p>
          <p className="reg-help" style={{ marginBottom: 0 }}>
            Two people deciding the same application at once is how one learner ends up both
            approved and rejected, so this one is read-only for you. It opens again when they
            finish, or shortly after they close it.
          </p>
        </div>
      )}

      {/* Two outcomes, and the documents decide which one is available: every
          document verified means approve, anything rejected means the
          application goes back to the parent. They are never both on. */}
      <div className="reg-actions">
        <button className="reg-btn reg-btn-blue" disabled={locked || deciding || !canApprove}
          title={heldBy ? `Under review by ${heldBy.name}` : (approveBlocked || undefined)}
          onClick={() => openSectionPicker('approve')}>
          Approve Application
        </button>
        <button className="reg-btn reg-btn-red" disabled={locked || deciding || !canReject}
          title={heldBy ? `Under review by ${heldBy.name}` : (canReject ? undefined : 'Reject at least one document first, so the parent is told what to replace.')}
          onClick={() => { setRemarks(remarksForRejected(docs)); setRejecting(true); }}>
          Reject Application
        </button>
      </div>

      {!locked && approveBlocked && (
        <p className="reg-help" role="status" style={problemDocs.length ? { color: 'var(--danger)' } : undefined}>
          {approveBlocked}
        </p>
      )}

      {rejecting && (
        <div className="dv-overlay" onMouseDown={(e) => e.target === e.currentTarget && !deciding && setRejecting(false)}>
          <div className="dv-dialog dv-small-dialog" role="dialog" aria-modal="true" aria-label="Send remarks to the parent">
            <h3>Return this application to the parent?</h3>
            <p>
              {app.guardian} will see these remarks and can replace only the documents you rejected.
              Everything already verified stays as it is.
            </p>
            <label className="reg-help" htmlFor="reject-remarks" style={{ margin: 0 }}>
              Remarks (written from the rejected documents — edit if you need to)
            </label>
            <textarea id="reject-remarks" className="reg-textarea" value={remarks} rows={9} maxLength={1000}
              onChange={(e) => setRemarks(e.target.value)} />
            <div className="reg-actions" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="reg-btn reg-btn-plain" disabled={deciding}
                onClick={() => setRejecting(false)}>Cancel</button>
              <button type="button" className="reg-btn reg-btn-red on" disabled={deciding || !remarks.trim()}
                onClick={() => decide('reject', 'The application was returned to the parent with your remarks.')}>
                {deciding ? 'Sending…' : 'Send remarks'}
              </button>
            </div>
          </div>
        </div>
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