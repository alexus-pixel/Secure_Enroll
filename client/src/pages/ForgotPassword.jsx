import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from '../components/AppNav';
import api from '../api/client';
import { validateEmail } from '../utils/validators';
import { useScrollToError } from '../hooks/useScrollToError';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  useScrollToError(error);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const formatError = validateEmail(email);
    if (formatError) {
      setError(formatError);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
    } finally {
      // The server always replies the same way whether or not the account
      // exists, on purpose -- so the UI shows the same confirmation too,
      // even if the request itself somehow failed.
      setSubmitting(false);
      setSent(true);
    }
  }

  return (
    <div className="auth-wrap">
      <aside className="auth-panel">
        <div>
          <Brand to="/" />
          <h2>Reset your password</h2>
          <p>We will email you a link to choose a new password.</p>
        </div>
        <div className="auth-foot">
          This system contains only dummy data. All information is made up for
          demonstration purposes.
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-form">
          {sent ? (
            <>
              <h1>Check your email</h1>
              <div className="alert alert-note">
                If an account exists for that email address, we have sent a reset link. The link expires in 1 hour.
              </div>
              <p className="auth-alt"><Link to="/login">Back to sign in</Link></p>
            </>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <h1>Forgot password</h1>
              <p className="sub">Enter the email address for your account.</p>

              <div className="field">
                <label className="label" htmlFor="email">Email Address</label>
                <input id="email" className={`input${error ? ' input-error' : ''}`} type="email"
                  placeholder="e.g. juandelacruz@gmail.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    // Only once something is typed, so the box does not turn
                    // red the moment it is cleared.
                    setError(e.target.value.trim() ? validateEmail(e.target.value) : '');
                  }}
                  autoComplete="email" required />
                {error && <p className="field-error">{error}</p>}
              </div>

              <button className="btn btn-primary" style={{ width: '100%' }} type="submit" disabled={submitting}>
                {submitting ? 'Sending\u2026' : 'Send reset link'}
              </button>
              <p className="auth-alt"><Link to="/login">Back to sign in</Link></p>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}