import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Brand } from '../components/AppNav';
import PasswordInput from '../components/PasswordInput';
import VerifyEmailOverlay from '../components/VerifyEmailOverlay';
import { useScrollToError } from '../hooks/useScrollToError';

// "4:05" or "45 seconds" — what is left on a lockout, read aloud correctly.
function countdownText(seconds) {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
  }
  return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  useScrollToError(error);
  const [submitting, setSubmitting] = useState(false);
  const { login, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const justRegistered = location.state?.registered;
  const justReset = location.state?.passwordReset;
  const justVerified = location.state?.verified;
  // Set when the server refuses a sign-in because the email is not verified yet.
  const [gate, setGate] = useState(null);
  // Seconds left on a lockout, counted down here so the page says exactly when
  // it lifts and lets the person back in by itself, with nothing to refresh.
  const [lockLeft, setLockLeft] = useState(0);

  // True for the moment after a lockout runs out, so the page says so.
  const [lockUnlocked, setLockUnlocked] = useState(false);

  // True when an administrator has deactivated the account: either the sign-in
  // was refused for that reason, or api/client.js sent the browser here after
  // a session that was already open was cut off mid-use. It is worked out from
  // the server's answer every time, never remembered, so an account switched
  // off, back on, and off again says exactly the same thing on every attempt.
  const [deactivated, setDeactivated] = useState(
    () => new URLSearchParams(location.search).get('deactivated') === '1'
  );

  // Nothing of the cut-off session should be left behind in this browser.
  useEffect(() => {
    if (deactivated) logout();
  }, [deactivated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (lockLeft <= 0) return undefined;
    setLockUnlocked(false);
    const timer = setInterval(() => {
      setLockLeft((left) => {
        if (left <= 1) {
          setError('');
          setLockUnlocked(true);
          return 0;
        }
        return left - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lockLeft]);

  function goHome(user) {
    // An account created by an administrator still has a temporary password
    // and has to replace it before anything else.
    if (user.mustChangePassword) return navigate('/change-password', { replace: true });
    // Send each role to its own home screen.
    const home = { admin: '/admin/dashboard', registrar: '/registrar' };
    navigate(home[user.role] || '/dashboard');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (lockLeft > 0) return;
    setLockUnlocked(false);
    setError('');
    setSubmitting(true);
    try {
      goHome(await login(email, password));
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === 'ACCOUNT_DEACTIVATED') {
        // Not a wrong password: the account itself has been switched off, and
        // saying so plainly saves the person guessing at their password.
        setLockLeft(0);
        setError('');
        setDeactivated(true);
      } else if (err.response?.status === 403 && data?.code === 'EMAIL_NOT_VERIFIED' && data.ticket) {
        setGate({ ticket: data.ticket, emailSent: data.emailSent, retryAfter: data.retryAfter });
      } else if (err.response?.status === 423 || err.response?.status === 429) {
        // Locked out. The reply carries the exact moment it lifts, which the
        // countdown above runs to.
        const seconds = Number(data?.retryAfter) || 60;
        setLockLeft(seconds);
        setError(data?.message || 'Too many failed sign-in attempts. This account is locked.');
      } else {
        // The server says how many tries are left before the account locks.
        const left = data?.attemptsLeft;
        setLockLeft(0);
        setError(
          (data?.message || 'We could not sign you in. Please try again.')
          + (typeof left === 'number' && left > 0
            ? ` ${left} ${left === 1 ? 'attempt' : 'attempts'} left before this account is locked.`
            : '')
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Runs when the parent clicks "Continue signing in" after verifying.
  async function continueSignIn() {
    try {
      goHome(await login(email, password));
    } catch (err) {
      setGate(null);
      setError(err.response?.data?.message || 'We could not sign you in. Please try again.');
    }
  }

  return (
    <div className="auth-wrap">
      <aside className="auth-panel">
        <div>
          <Brand to="/" />
          <h2>Enrollment for Caloocan City Elementary School</h2>
          <p>
            Welcome to the online enrollment system of Caloocan City Elementary School,
            where convenience and simplicity come together to make enrollment easy.
          </p>
        </div>
        <div className="auth-foot">
          This system contains only dummy data. All information is made up for
          demonstration purposes.
        </div>
      </aside>

      <main className="auth-main">
        {deactivated ? (
          <div className="auth-form" role="alert">
            <h1>Account deactivated</h1>
            <p className="sub">Your account was deactivated by the administrator.</p>
            <div className="alert alert-error">
              This account can no longer be used to sign in. Nothing you typed was
              wrong. If you think this is a mistake, please contact the registrar&rsquo;s
              office.
            </div>
            <button
              className="btn btn-primary" style={{ width: '100%' }} type="button"
              onClick={() => navigate('/')}
            >
              Back to home page
            </button>
          </div>
        ) : (
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <button type="button" className="back-link" id="login-back" onClick={() => navigate('/')}>
            &larr; Back
          </button>
          <h1>Sign in</h1>
          <p className="sub">Sign in with the email address and password for your account.</p>
          {justVerified && !error && (
            <div className="alert alert-note">Your account is verified. Please sign in.</div>
          )}
          {justRegistered && !justVerified && !error && (
            <div className="alert alert-note">Account created. Please verify your email address, then sign in.</div>
          )}
          {justReset && !error && (
            <div className="alert alert-note">Password updated. Please sign in.</div>
          )}
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
              {lockLeft > 0 && (
                <div className="lock-countdown" aria-live="polite">
                  You can try again in <b>{countdownText(lockLeft)}</b>.
                </div>
              )}
            </div>
          )}
          {!error && lockUnlocked && (
            <div className="alert alert-note" role="status">You can try signing in again now.</div>
          )}

          <div className="field">
            <label className="label" htmlFor="email">Email Address</label>
            <input id="email" className="input" type="email" value={email}
              placeholder="name@gmail.com"
              onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </div>

          <PasswordInput
            id="password"
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <p className="forgot-link"><Link to="/forgot-password">Forgot password?</Link></p>

          <button
            className="btn btn-primary" style={{ width: '100%' }} type="submit"
            disabled={submitting || lockLeft > 0}
            title={lockLeft > 0 ? `Locked for another ${countdownText(lockLeft)}` : undefined}
          >
            {submitting ? 'Signing in\u2026' : lockLeft > 0 ? `Locked \u2014 ${countdownText(lockLeft)}` : 'Sign in'}
          </button>
          <p className="auth-alt">New parent or guardian? <Link to="/register">Create an account</Link></p>
        </form>
        )}
      </main>

      {gate && (
        <VerifyEmailOverlay
          ticket={gate.ticket}
          email={email.trim()}
          emailSent={gate.emailSent}
          retryAfter={gate.retryAfter}
          variant="signin"
          onVerified={continueSignIn}
          onClose={() => setGate(null)}
        />
      )}
    </div>
  );
}