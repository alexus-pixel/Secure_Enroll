import { useEffect, useRef, useState } from 'react';

import { DOC_ACTIONS, DOC_STATUS_LABEL } from './docMeta';

export function DocStatusBadge({ doc }) {
  if (doc.status === 'pending' && doc.resubmitted) return <span className="reg-badge reg-badge-resubmitted">Resubmitted</span>;
  if (doc.status === 'awaiting') return <span className="reg-badge reg-badge-awaiting">{DOC_STATUS_LABEL.awaiting}</span>;
  return <span className={`reg-badge reg-badge-${doc.status}`}>{DOC_STATUS_LABEL[doc.status] || doc.status}</span>;
}

/**
 * Small confirmation dialog used when flagging or rejecting from the
 * document list. The reason is optional but is shown to the parent.
 */
export function ReasonDialog({ status, docName, onConfirm, onCancel }) {
  const action = DOC_ACTIONS[status];
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await onConfirm(status, note);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="dv-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="dv-dialog dv-small-dialog" role="dialog" aria-modal="true" aria-label={`${action.label} ${docName}`}>
        <h3>{action.label} &ldquo;{docName}&rdquo;?</h3>
        <p>{action.hint}</p>
        <label className="reg-help" htmlFor="reason-text" style={{ margin: 0 }}>
          Reason (optional, shown to the parent)
        </label>
        <textarea id="reason-text" ref={ref} className="reg-textarea" value={note} maxLength={500}
          onChange={(e) => setNote(e.target.value)} placeholder="e.g. The photo is blurry; please upload a clearer copy." />
        {error && <div className="dv-error" role="alert">{error}</div>}
        <div className="reg-actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="reg-btn reg-btn-plain" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={`reg-btn ${action.cls} on`} onClick={confirm} disabled={busy}>
            {busy ? 'Saving…' : action.label}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The Verify / Flag / Reject controls shown under the document viewer,
 * so the registrar decides while looking at the file.
 */
const MIN_REASON_WORDS = 3;
const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;

export function ViewerActions({ doc, lockedMessage, onAction }) {
  const [note, setNote] = useState(doc.note || '');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [reasonInvalid, setReasonInvalid] = useState(false);
  const locked = Boolean(lockedMessage);
  // Only a rejection needs words: the parent is being asked to send another
  // copy and has to be told what was wrong with this one. That sentence is
  // also what the application's remarks are written from when it is returned.
  const needsReason = (status) => status === 'rejected';
  const reasonText = `Write a reason of at least ${MIN_REASON_WORDS} words. The parent sees it so they know what to fix.`;

  async function run(status) {
    if (needsReason(status) && wordCount(note) < MIN_REASON_WORDS) {
      setReasonInvalid(true);
      setError('');
      return;
    }
    setBusy(status);
    setError('');
    try {
      await onAction(status, status === 'verified' ? '' : note);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save. Please try again.');
      setBusy('');
    }
  }

  return (
    <>
      <textarea className={`dv-reason${reasonInvalid ? ' is-invalid' : ''}`} value={note} maxLength={500}
        disabled={locked || Boolean(busy)}
        onChange={(e) => {
          setNote(e.target.value);
          if (reasonInvalid && wordCount(e.target.value) >= MIN_REASON_WORDS) setReasonInvalid(false);
          setError('');
        }}
        aria-label="Reason for rejecting"
        aria-invalid={reasonInvalid}
        aria-describedby={reasonInvalid ? 'dv-reason-warning' : undefined}
        placeholder="Reason for rejecting (at least 3 words, shown to the parent)" />
      {reasonInvalid && <div id="dv-reason-warning" className="dv-warning" role="alert">{reasonText}</div>}
      {error && <div className="dv-error" role="alert">{error}</div>}
      <div className="dv-foot-row">
        <span className="dv-hint">{locked ? lockedMessage : 'Your decision is saved for this document.'}</span>
        <div className="reg-actions">
          {Object.entries(DOC_ACTIONS).map(([status, a]) => (
            <button key={status} type="button"
              className={`reg-btn ${a.cls}${doc.status === status ? ' on' : ''}`}
              disabled={locked || Boolean(busy)} onClick={() => run(status)} title={a.hint}>
              {busy === status ? 'Saving…' : a.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
