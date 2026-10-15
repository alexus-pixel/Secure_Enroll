import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock } from 'lucide-react';
import api from '../api/client';
import '../styles/verify-overlay.css';

const POLL_MS = 3000;

// Keeps the page behind a modal from scrolling, and puts keyboard focus on
// the card so screen readers announce it.
function useModalFocus(ref, trigger) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);
  useEffect(() => { ref.current?.focus(); }, [ref, trigger]);
}

/**
 * The pop-up shown once an account has been verified. Also used on its own
 * by the page that the emailed link opens.
 */
export function VerifiedDialog({ onContinue }) {
  const cardRef = useRef(null);
  const [busy, setBusy] = useState(false);
  useModalFocus(cardRef, 'verified');

  async function handleContinue() {
    setBusy(true);
    try {
      await onContinue();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ve-overlay">
      <div className="ve-card" role="alertdialog" aria-modal="true" aria-labelledby="ve-verified-title"
        aria-describedby="ve-verified-text" tabIndex={-1} ref={cardRef}>
        <span className="ve-icon ve-icon-success"><CheckCircle2 size={32} aria-hidden="true" /></span>
        <h2 id="ve-verified-title">Account verified</h2>
        <p id="ve-verified-text">Account verified successfully. Continue signing in.</p>
        <div className="ve-actions">
          <button type="button" className="btn btn-primary" onClick={handleContinue} disabled={busy}>
            {busy ? 'Signing in…' : 'Continue signing in'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Full-page "Verifying email" overlay. It stays up until the parent clicks the
 * link in the email (which can happen in another tab or on another device),
 * then turns into the "Account verified" pop-up.
 *
 * `ticket` comes from the server when a sign-in is refused (or right after
 * sign-up). It is only good for checking verification status and requesting
 * another email.
 */
export default function VerifyEmailOverlay({
  ticket, email, emailSent, retryAfter, variant = 'signin', onVerified, onClose,
}) {
  const [phase, setPhase] = useState('waiting'); // waiting | verified | expired
  const [sent, setSent] = useState(Boolean(emailSent));
  const [cooldown, setCooldown] = useState(Number(retryAfter) || 0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { tone: 'ok' | 'error', text }
  const cardRef = useRef(null);
  useModalFocus(cardRef, phase);

  // Ask the server every few seconds whether the link has been clicked, and
  // again right away when the person comes back to this tab.
  useEffect(() => {
    if (phase !== 'waiting') return undefined;
    let stopped = false;

    async function check() {
      try {
        const { data } = await api.post('/auth/verification-status', { ticket });
        if (!stopped && data.verified) setPhase('verified');
      } catch (err) {
        if (!stopped && err.response?.status === 401) setPhase('expired');
      }
    }

    const timer = setInterval(check, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ticket, phase]);

  // Countdown for the "Resend email" button.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function resend() {
    setBusy(true);
    setNotice(null);
    try {
      const { data } = await api.post('/auth/verification-resend', { ticket });
      if (data.verified) {
        setPhase('verified');
        return;
      }
      setSent(true);
      setNotice({ tone: 'ok', text: data.message });
      setCooldown(data.retryAfter || 60);
    } catch (err) {
      const data = err.response?.data;
      if (err.response?.status === 401) {
        setPhase('expired');
        return;
      }
      if (err.response?.status === 429 && data?.retryAfter) setCooldown(data.retryAfter);
      setNotice({ tone: 'error', text: data?.message || 'We could not resend the email. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'verified') return <VerifiedDialog onContinue={onVerified} />;

  if (phase === 'expired') {
    return (
      <div className="ve-overlay">
        <div className="ve-card" role="alertdialog" aria-modal="true" aria-labelledby="ve-expired-title"
          tabIndex={-1} ref={cardRef}>
          <span className="ve-icon ve-icon-warn"><Clock size={30} aria-hidden="true" /></span>
          <h2 id="ve-expired-title">Verification session expired</h2>
          <p>This verification session has expired. Please sign in again to receive a new link.</p>
          <div className="ve-actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>Back to sign in</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ve-overlay">
      <div className="ve-card" role="alertdialog" aria-modal="true" aria-labelledby="ve-title"
        aria-describedby="ve-text" tabIndex={-1} ref={cardRef}>
        <div className="ve-spinner" aria-hidden="true" />
        <h2 id="ve-title">Verifying email</h2>
        <p className="ve-lead" id="ve-text">
          {variant === 'register'
            ? 'Your account has been created. Please verify your email address before signing in.'
            : 'Please verify your email address before signing in.'}
        </p>
        {sent ? (
          <p>We sent a verification link to <strong>{email}</strong>. Open the email and click the link to continue.</p>
        ) : (
          <p>We could not send the email just now. Please press &ldquo;Resend email&rdquo; to try again.</p>
        )}
        <p className="ve-hint">
          This screen updates automatically once your email is verified. If you cannot find the email,
          please check your spam folder.
        </p>

        <div aria-live="polite">
          {notice && <div className={`ve-notice ve-notice-${notice.tone}`}>{notice.text}</div>}
        </div>

        <div className="ve-actions">
          <button type="button" className="btn btn-primary" onClick={resend} disabled={busy || cooldown > 0}>
            {busy ? 'Sending…' : cooldown > 0 ? `Resend email (${cooldown}s)` : 'Resend email'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {variant === 'register' ? 'Go to sign in' : 'Back to sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}
