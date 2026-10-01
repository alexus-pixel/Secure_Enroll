import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Brand } from '../components/AppNav';
import PasswordInput from '../components/PasswordInput';
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

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-wrap">
      <aside className="auth-panel">
        <div>
          <Brand />
          <h2>Enrollment for Caloocan City Elementary School</h2>
          <p>
            Welcome to the online enrollment system of Caloocan City Elementary School.
            Where seamless and convenience collide to create an efficient enrollment process.
          </p>
        </div>
        <div className="auth-foot">
          This system is full of dummy data and all the information is only made up for
          demonstration purposes.
        </div>
      </aside>

      <main className="auth-main">
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <h1>Sign in</h1>
          <p className="sub">Use the account your school registered for you.</p>
          {justRegistered && !error && (
            <div className="alert alert-note">Account created &mdash; please sign in.</div>
          )}
          {justReset && !error && (
            <div className="alert alert-note">Password updated &mdash; please sign in.</div>
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
            {submitting ? 'Signing in\u2026' : 'Log in'}
          </button>
          <p className="auth-alt">New parent or guardian? <Link to="/register">Create an Account</Link></p>
        </form>
      </main>
    </div>
  );
}
