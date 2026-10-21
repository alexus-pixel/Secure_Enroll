import { useEffect } from 'react';

/**
 * A short confirmation that something was saved.
 *
 * Saving used to leave the page looking exactly as it did before, which is
 * indistinguishable from nothing happening — so this says so where the eye
 * already is, and takes itself away a few seconds later. It is an
 * announcement, not a dialog: it never takes focus, and the same wording stays
 * on the page underneath for anyone who looks back a minute later.
 *
 * `message` null hides it. Changing the message restarts the timer.
 */
export default function Toast({ message, tone = 'success', onDone, duration = 4000 }) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => onDone && onDone(), duration);
    return () => clearTimeout(timer);
  }, [message, duration, onDone]);

  if (!message) return null;
  return (
    <div className={`toast toast-${tone} toast-row`} role="status" aria-live="polite">
      <span className="toast-mark" aria-hidden="true">{tone === 'success' ? '✓' : '!'}</span>
      <span>{message}</span>
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => onDone && onDone()}>
        ×
      </button>
    </div>
  );
}
