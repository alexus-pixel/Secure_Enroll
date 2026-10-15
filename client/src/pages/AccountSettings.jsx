import { useEffect, useState } from 'react';
import AppNav from '../components/AppNav';
import PasswordInput from '../components/PasswordInput';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { validateName, validatePassword, validateConfirmPassword } from '../utils/validators';
import { useScrollToError } from '../hooks/useScrollToError';

export default function AccountSettings() {
  const { user, updateUser } = useAuth();

  // ---- Profile card ----
  const [profile, setProfile] = useState({ firstName: '', middleName: '', lastName: '' });
  const [profileErrors, setProfileErrors] = useState({});
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  useScrollToError(profileError);
  const [savingProfile, setSavingProfile] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/auth/me')
      .then(({ data }) => setProfile({
        firstName: data.firstName || '', middleName: data.middleName || '', lastName: data.lastName || '',
      }))
      .finally(() => setLoading(false));
  }, []);

  function updateProfileField(field) {
    return (e) => setProfile((p) => ({ ...p, [field]: e.target.value }));
  }

  async function saveProfile(e) {
    e.preventDefault();
    setProfileMessage('');
    setProfileError('');

    const nextErrors = {
      firstName: validateName(profile.firstName, { label: 'First name' }),
      lastName: validateName(profile.lastName, { label: 'Last name' }),
      middleName: validateName(profile.middleName, { required: false, label: 'M.I.' }),
    };
    setProfileErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    setSavingProfile(true);
    try {
      const { data } = await api.patch('/auth/me', profile);
      updateUser(data);
      setProfileMessage('Profile updated.');
    } catch (err) {
      setProfileError(err.response?.data?.message || 'Could not save your profile.');
    } finally {
      setSavingProfile(false);
    }
  }

  // ---- Change password card ----
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwErrors, setPwErrors] = useState({});
  const [pwMessage, setPwMessage] = useState('');
  const [pwError, setPwError] = useState('');
  useScrollToError(pwError);
  const [savingPassword, setSavingPassword] = useState(false);

  function updatePwField(field) {
    return (e) => setPwForm((p) => ({ ...p, [field]: e.target.value }));
  }

  async function savePassword(e) {
    e.preventDefault();
    setPwMessage('');
    setPwError('');

    const nextErrors = {
      currentPassword: pwForm.currentPassword ? '' : 'Current password is required.',
      newPassword: validatePassword(pwForm.newPassword),
      confirmPassword: validateConfirmPassword(pwForm.newPassword, pwForm.confirmPassword),
    };
    setPwErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    setSavingPassword(true);
    try {
      await api.put('/auth/me/password', {
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      });
      setPwMessage('Password updated.');
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setPwError(err.response?.data?.message || 'Could not update your password.');
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <>
      <AppNav crumbs={[{ label: 'Account Settings' }]} />
      <div className="container container-narrow">
        <div className="page-head">
          <div>
            <h1>Account Settings</h1>
            <p>Update your name and password</p>
          </div>
        </div>

        <form className="card" onSubmit={saveProfile} noValidate>
          <h2>Profile</h2>
          {loading ? (
            <p className="muted">Loading&hellip;</p>
          ) : (
            <>
              <div className="field-grid cols-3">
                <div>
                  <label className="label" htmlFor="firstName">First name</label>
                  <input id="firstName" className={`input${profileErrors.firstName ? ' input-error' : ''}`}
                    value={profile.firstName} onChange={updateProfileField('firstName')} required />
                  {profileErrors.firstName && <p className="field-error">{profileErrors.firstName}</p>}
                </div>
                <div>
                  <label className="label" htmlFor="lastName">Last name</label>
                  <input id="lastName" className={`input${profileErrors.lastName ? ' input-error' : ''}`}
                    value={profile.lastName} onChange={updateProfileField('lastName')} required />
                  {profileErrors.lastName && <p className="field-error">{profileErrors.lastName}</p>}
                </div>
                <div>
                  <label className="label" htmlFor="middleName">M.I</label>
                  <input id="middleName" className={`input${profileErrors.middleName ? ' input-error' : ''}`}
                    value={profile.middleName} onChange={updateProfileField('middleName')} maxLength={4} />
                  {profileErrors.middleName && <p className="field-error">{profileErrors.middleName}</p>}
                </div>
              </div>

              <div className="field">
                <label className="label" htmlFor="email">Email Address</label>
                <input id="email" className="input" value={user?.email || ''} disabled />
              </div>

              {profileMessage && <div className="alert alert-note">{profileMessage}</div>}
              {profileError && <div className="alert alert-error">{profileError}</div>}
              <button className="btn btn-primary" type="submit" disabled={savingProfile}>
                {savingProfile ? 'Saving\u2026' : 'Save Changes'}
              </button>
            </>
          )}
        </form>

        <form className="card" onSubmit={savePassword} noValidate>
          <h2>Change Password</h2>
          <PasswordInput
            id="currentPassword" label="Current password" value={pwForm.currentPassword}
            onChange={updatePwField('currentPassword')} autoComplete="current-password"
            error={pwErrors.currentPassword}
          />
          <div className="field-grid cols-2">
            <PasswordInput
              id="newPassword" label="New password" value={pwForm.newPassword}
              onChange={updatePwField('newPassword')} error={pwErrors.newPassword} showRules
            />
            <PasswordInput
              id="confirmNewPassword" label="Confirm new password" value={pwForm.confirmPassword}
              onChange={updatePwField('confirmPassword')} error={pwErrors.confirmPassword}
            />
          </div>

          {pwMessage && <div className="alert alert-note">{pwMessage}</div>}
          {pwError && <div className="alert alert-error">{pwError}</div>}
          <button className="btn btn-primary" type="submit" disabled={savingPassword}>
            {savingPassword ? 'Updating\u2026' : 'Update Password'}
          </button>
        </form>
      </div>
    </>
  );
}
