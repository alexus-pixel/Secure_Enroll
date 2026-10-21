import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Brand } from '../components/AppNav';
import PasswordInput from '../components/PasswordInput';
import { useScrollToError } from '../hooks/useScrollToError';
import { validatePassword, validateConfirmPassword } from '../utils/validators';

/**
 * Shown to a registrar or administrator whose account was created by an
 * administrator and still has its temporary password. Until it is replaced
 * the account cannot reach anything else: the server refuses every other
 * request with PASSWORD_CHANGE_REQUIRED, and api/client.js sends them here.
 */
export default function ChangePassword() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  useScrollToError(error);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();

  function goHome(role) {
    navigate({ admin: '/admin/dashboard', registrar: '/registrar' }[role] || '/dashboard', { replace: true });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const found = {
      newPassword: validatePassword(newPassword),
      confirm: validateConfirmPassword(newPassword, confirm),
    };
    if (!currentPassword) found.currentPassword = 'Enter the temporary password you were given.';
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;

    setSaving(true);
    try {
      await api.put('/auth/me/password', { currentPassword, newPassword });
      updateUser({ mustChangePassword: false });
      goHome(user?.role);
    } catch (err) {
      setError(err.response?.data?.message || 'We could not change your password. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-wrap">
      <aside className="auth-panel">
        <div>
          <Brand to="/" />
          <h2>One step before you start</h2>
          <p>
            Your account was created for you with a temporary password. Choose a password only you know,
            and the rest of the system opens up.
          </p>
        </div>
        <div className="auth-foot">
          This system contains only dummy data. All information is made up for demonstration purposes.
        </div>
      </aside>

      <main className="auth-main">
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <h1>Choose your password</h1>
          <p className="sub">
            Signed in as {user?.email}. This is asked once, because the password you have now was set by
            an administrator.
          </p>

          {error && <div className="alert alert-error" role="alert">{error}</div>}

          <PasswordInput
            id="currentPassword"
            label="Temporary password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            error={errors.currentPassword}
            autoComplete="current-password"
          />
          <PasswordInput
            id="newPassword"
            label="New password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setErrors((p) => ({ ...p, newPassword: e.target.value ? validatePassword(e.target.value) : '' }));
            }}
            error={errors.newPassword}
            showRules
          />
          <PasswordInput
            id="confirmPassword"
            label="Confirm new password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setErrors((p) => ({ ...p, confirm: e.target.value ? validateConfirmPassword(newPassword, e.target.value) : '' }));
            }}
            error={errors.confirm}
          />

          <button className="btn btn-primary" style={{ width: '100%' }} type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save password and continue'}
          </button>
          <p className="auth-alt">
            <button type="button" className="link-button" onClick={() => { logout(); navigate('/login', { replace: true }); }}>
              Sign out instead
            </button>
          </p>
        </form>
      </main>
    </div>
  );
}
