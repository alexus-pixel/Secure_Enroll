import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Brand } from '../components/AppNav';
import PasswordInput from '../components/PasswordInput';
import VerifyEmailOverlay from '../components/VerifyEmailOverlay';
import { useScrollToError } from '../hooks/useScrollToError';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  useScrollToError(error);
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const justRegistered = location.state?.registered;
  const justReset = location.state?.passwordReset;
  const justVerified = location.state?.verified;
  // Set when the server refuses a sign-in because the email is not verified yet.
  const [gate, setGate] = useState(null);

  function goHome(user) {
    // Send each role to its own home screen.
    const home = { admin: '/admin/dashboard', registrar: '/registrar' };
    navigate(home[user.role] || '/dashboard');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      goHome(await login(email, password));
    } catch (err) {
      const data = err.response?.data;
      if (err.response?.status === 403 && data?.code === 'EMAIL_NOT_VERIFIED' && data.ticket) {
        setGate({ ticket: data.ticket, emailSent: data.emailSent, retryAfter: data.retryAfter });
      } else {
        setError(data?.message || 'We could not sign you in. Please try again.');
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
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
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
          {error && <div className="alert alert-error">{error}</div>}

          <div className="field">
            <label className="label" htmlFor="email">Email Address</label>
            <input id="email" className="input" type="email" value={email}
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

          <button className="btn btn-primary" style={{ width: '100%' }} type="submit" disabled={submitting}>
            {submitting ? 'Signing in\u2026' : 'Sign in'}
          </button>
          <p className="auth-alt">New parent or guardian? <Link to="/register">Create an account</Link></p>
        </form>
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