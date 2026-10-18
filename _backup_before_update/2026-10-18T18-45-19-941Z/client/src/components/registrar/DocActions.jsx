import { useEffect, useRef, useState } from 'react';

import { DOC_ACTIONS, DOC_STATUS_LABEL } from './docMeta';

export function DocStatusBadge({ doc }) {
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
export function ViewerActions({ doc, disabled, onAction }) {
  const [note, setNote] = useState(doc.note || '');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const needsReason = (status) => status === 'flagged' || status === 'rejected';
  const reasonMissing = note.trim().length === 0;

  async function run(status) {
    if (needsReason(status) && reasonMissing) {
      setError('Write a reason first. The parent sees it so they know what to fix.');
      return;
    }
    setBusy(status);
    setError('');
    try {
      await onAction(status, note);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save. Please try again.');
      setBusy('');
    }
  }

  return (
    <>
      <textarea className="dv-reason" value={note} maxLength={500} disabled={disabled || Boolean(busy)}
        onChange={(e) => { setNote(e.target.value); setError(''); }}
        aria-label="Reason for flagging or rejecting (required)"
        aria-required="true"
        placeholder="Reason (required to flag or reject, shown to the parent)" />
      {error && <div className="dv-error" role="alert">{error}</div>}
      <div className="dv-foot-row">
        <span className="dv-hint">
          {disabled
            ? 'This application is finalized.'
            : reasonMissing ? 'Flag and Reject need a reason.' : 'Your decision is saved for this document.'}
        </span>
        <div className="reg-actions">
          {Object.entries(DOC_ACTIONS).map(([status, a]) => (
            <button key={status} type="button"
              className={`reg-btn ${a.cls}${doc.status === status ? ' on' : ''}`}
              disabled={disabled || Boolean(busy) || (needsReason(status) && reasonMissing)}
              onClick={() => run(status)} title={needsReason(status) && reasonMissing ? 'Write a reason first' : a.hint}>
              {busy === status ? 'Saving…' : a.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
