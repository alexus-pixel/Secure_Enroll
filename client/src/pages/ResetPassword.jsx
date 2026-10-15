import { useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { Brand } from '../components/AppNav';
import PasswordInput from '../components/PasswordInput';
import api from '../api/client';
import { validatePassword, validateConfirmPassword } from '../utils/validators';
import { useScrollToError } from '../hooks/useScrollToError';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  useScrollToError(formError);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');

    if (!token) {
      setFormError('This reset link is missing its token. Request a new one below.');
      return;
    }

    const nextErrors = {
      password: validatePassword(password),
      confirmPassword: validateConfirmPassword(password, confirmPassword),
    };
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    setSubmitting(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: password });
      navigate('/', { state: { passwordReset: true } });
    } catch (err) {
      setFormError(err.response?.data?.message || 'Could not reset your password.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-wrap">
      <aside className="auth-panel">
        <div>
          <Brand />
          <h2>Choose a new password</h2>
          <p>Pick something you haven&rsquo;t used on this account before.</p>
        </div>
        <div className="auth-foot">
          This system is full of dummy data and all the information is only made up for
          demonstration purposes.
        </div>
      </aside>

      <main className="auth-main">
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <h1>Reset password</h1>
          <p className="sub">Enter a new password for your account.</p>
          {formError && (
            <div className="alert alert-error">
              {formError}{' '}
              {!token && <Link to="/forgot-password">Request a new link</Link>}
            </div>
          )}

          <PasswordInput
            id="password" label="New password" value={password}
            onChange={(e) => setPassword(e.target.value)} error={errors.password} showRules
          />
          <PasswordInput
            id="confirmPassword" label="Confirm new password" value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)} error={errors.confirmPassword}
          />

          <button className="btn btn-primary" style={{ width: '100%' }} type="submit" disabled={submitting}>
            {submitting ? 'Updating\u2026' : 'Update password'}
          </button>
          <p className="auth-alt"><Link to="/">Back to sign in</Link></p>
        </form>
      </main>
    </div>
  );
}
