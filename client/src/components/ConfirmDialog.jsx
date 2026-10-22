import { useEffect, useRef } from 'react';

/**
 * A yes/no dialog for an action that cannot simply be undone: disabling an
 * account, deleting a section, rolling the school year over.
 *
 * It takes the focus when it opens, closes on Escape, and returns the focus
 * to whatever opened it, so it works the same with a keyboard as with a mouse.
 *
 *   <ConfirmDialog
 *     title="Disable this account?"
 *     confirmLabel="Disable account"
 *     tone="danger"                 // 'danger' | 'primary'
 *     busy={saving}
 *     onConfirm={...} onClose={...}>
 *     <p>Any sentence explaining what will happen.</p>
 *   </ConfirmDialog>
 */
export default function ConfirmDialog({
  title, children, confirmLabel = 'Continue', cancelLabel = 'Cancel',
  tone = 'primary', busy = false, disabled = false, onConfirm, onClose,
}) {
  const panel = useRef(null);
  const opener = useRef(null);

  useEffect(() => {
    opener.current = document.activeElement;
    // A dialog that asks for something typed (a password) starts in that box.
    panel.current?.querySelector('input, button')?.focus();
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener.current && opener.current.focus) opener.current.focus();
    };
  }, [busy, onClose]);

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="modal-panel modal-panel-sm" ref={panel}
        role="alertdialog" aria-modal="true" aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 style={{ marginBottom: 2 }}>{title}</h2>
        </div>
        <div className="confirm-body">{children}</div>
        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy || disabled}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
