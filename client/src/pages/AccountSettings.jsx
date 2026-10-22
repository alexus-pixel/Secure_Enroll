import { useEffect, useState } from 'react';
import AppNav from '../components/AppNav';
import ConfirmDialog from '../components/ConfirmDialog';
import Toast from '../components/Toast';
import PasswordInput from '../components/PasswordInput';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  validateName, validateInitial, validatePassword, validateConfirmPassword, INITIAL_MAX, NAME_MAX,
  validateGmail, validateEmail,
} from '../utils/validators';
import { useScrollToError } from '../hooks/useScrollToError';

export default function AccountSettings() {
  const { user, updateUser } = useAuth();

  // ---- Profile card ----
  const [profile, setProfile] = useState({ firstName: '', middleName: '', lastName: '', email: '' });
  // The address as it stands on the account, kept apart from the box so the
  // page can tell whether it is actually being changed.
  const [emailOnFile, setEmailOnFile] = useState('');
  const [profileErrors, setProfileErrors] = useState({});
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  useScrollToError(profileError);
  const [savingProfile, setSavingProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  // Shown for a few seconds at the top of the screen once a save goes through.
  const [toast, setToast] = useState(null);

  useEffect(() => {
    api.get('/auth/me')
      .then(({ data }) => { setEmailOnFile(data.email || ''); return data; })
      .then((data) => setProfile({
        firstName: data.firstName || '', middleName: data.middleName || '', lastName: data.lastName || '',
        // The address on file, not the one saved in this browser, which can be
        // older than the account.
        email: data.email || '',
      }))
      .finally(() => setLoading(false));
  }, []);

  function updateProfileField(field) {
    return (e) => setProfile((p) => ({ ...p, [field]: e.target.value }));
  }

  /**
   * One button saves the whole page. The name fields always hold what is
   * currently on file, so leaving one alone keeps it as it was, and none of
   * them may be left blank. The password boxes are the exception: leave all
   * three empty and the password is simply not touched; fill any one of them
   * in and all three are required.
   */
  const [confirming, setConfirming] = useState(null); // what the save will do

  // The button asks first; saveAll does the work once that is answered.
  function askToSave(e) {
    e.preventDefault();
    setProfileMessage('');
    setProfileError('');
    setPwError('');

    const nextErrors = {
      firstName: validateName(profile.firstName, { label: 'First name' }),
      lastName: validateName(profile.lastName, { label: 'Last name' }),
      middleName: validateInitial(profile.middleName),
      // A parent signs in with a Gmail, which is what the server asks of them
      // too; any other role's address may sit on the school's own domain.
      email: user?.role === 'parent'
        ? validateGmail(profile.email, { label: 'Email address' })
        : validateEmail(profile.email),
    };
    setProfileErrors(nextErrors);

    // Only a typed NEW password means a password change. The current-password
    // box alone does not: browsers fill it in by themselves, and that must not
    // stop a name or email change from being saved.
    const changingPassword = Boolean(pwForm.newPassword || pwForm.confirmPassword);
    const pwNext = changingPassword ? {
      currentPassword: pwForm.currentPassword ? '' : 'Enter your current password.',
      newPassword: validatePassword(pwForm.newPassword),
      confirmPassword: validateConfirmPassword(pwForm.newPassword, pwForm.confirmPassword),
    } : {};
    setPwErrors(pwNext);

    if (Object.values(nextErrors).some(Boolean) || Object.values(pwNext).some(Boolean)) {
      setProfileError('Please correct the highlighted fields.');
      return;
    }
    const changingEmail = profile.email.trim().toLowerCase() !== emailOnFile.trim().toLowerCase();
    setConfirming({ changingPassword, changingEmail });
  }

  async function saveAll() {
    const changingPassword = Boolean(confirming && confirming.changingPassword);
    setSavingProfile(true);
    if (changingPassword) setSavingPassword(true);
    const done = [];
    let emailNote = '';
    try {
      const { data } = await api.patch('/auth/me', profile);
      updateUser(data);
      done.push('Profile');
      if (data.emailChanged) {
        setEmailOnFile(data.email || '');
        // Saying this on the page matters: the account is unverified again
        // until the link in that email is opened, and the parent needs to know
        // the email went to the new address, not the one they had before.
        emailNote = data.verificationSent
          ? ` We have emailed a verification link to ${data.email}. Please open it to confirm your new email address.`
          : ` Your email address is now ${data.email}, but we could not send the verification link just now.`
            + ' The banner on your dashboard can send it again in a few minutes.';
      }
    } catch (err) {
      setProfileError(err.response?.data?.message || 'Could not save your profile.');
    } finally {
      setSavingProfile(false);
    }

    if (changingPassword) {
      try {
        await api.put('/auth/me/password', {
          currentPassword: pwForm.currentPassword,
          newPassword: pwForm.newPassword,
        });
        setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
        done.push('password');
      } catch (err) {
        setPwError(err.response?.data?.message || 'Could not update your password.');
      } finally {
        setSavingPassword(false);
      }
    }

    if (done.length) {
      const what = done.join(' and ');
      // Said twice on purpose: once where the eye is, and once on the page
      // itself for anyone who looks back after the toast has gone.
      setProfileMessage(`${what} updated. Your changes are saved.${emailNote}`);
      setToast(`${what} updated.`);
    }
  }

  // ---- Change password card ----
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwErrors, setPwErrors] = useState({});
  const [pwError, setPwError] = useState('');
  useScrollToError(pwError);
  const [savingPassword, setSavingPassword] = useState(false);

  function updatePwField(field) {
    return (e) => setPwForm((p) => ({ ...p, [field]: e.target.value }));
  }

  return (
    <>
      <AppNav crumbs={[{ label: 'Edit Profile' }]} />
      <Toast message={toast} onDone={() => setToast(null)} />
      <div className="container container-narrow">
        <div className="page-head">
          <div>
            <h1>Edit Profile</h1>
            <p>Update your name, email address and password</p>
          </div>
        </div>

        <form onSubmit={askToSave} noValidate>
        <div className="card">
          <h2>Profile</h2>
          {loading ? (
            <p className="muted">Loading&hellip;</p>
          ) : (
            <>
              <div className="field-grid cols-3">
                <div>
                  <label className="label" htmlFor="firstName">First name</label>
                  <input id="firstName" className={`input${profileErrors.firstName ? ' input-error' : ''}`}
                    value={profile.firstName} onChange={updateProfileField('firstName')} maxLength={NAME_MAX} required />
                  {profileErrors.firstName && <p className="field-error">{profileErrors.firstName}</p>}
                </div>
                <div>
                  <label className="label" htmlFor="lastName">Last name</label>
                  <input id="lastName" className={`input${profileErrors.lastName ? ' input-error' : ''}`}
                    value={profile.lastName} onChange={updateProfileField('lastName')} maxLength={NAME_MAX} required />
                  {profileErrors.lastName && <p className="field-error">{profileErrors.lastName}</p>}
                </div>
                <div>
                  <label className="label" htmlFor="middleName">M.I. (optional)</label>
                  <input id="middleName" className={`input${profileErrors.middleName ? ' input-error' : ''}`}
                    value={profile.middleName} onChange={updateProfileField('middleName')} maxLength={INITIAL_MAX} />
                  {profileErrors.middleName && <p className="field-error">{profileErrors.middleName}</p>}
                </div>
              </div>

              <div className="field">
                <label className="label" htmlFor="email">Email Address</label>
                <input id="email" className={`input${profileErrors.email ? ' input-error' : ''}`}
                  type="email" value={profile.email} onChange={updateProfileField('email')}
                  autoComplete="email" required />
                {profileErrors.email && <p className="field-error">{profileErrors.email}</p>}
                <p className="hint">
                  This is the address you sign in with. If you change it, we email a
                  verification link to the new address and your account counts as
                  unverified until you open it.
                </p>
              </div>

            </>
          )}
        </div>

        <div className="card">
          <h2>Change Password</h2>
          <p className="hint hint-spaced">
            Leave the new password boxes empty to keep your current password.
          </p>
          <PasswordInput
            id="currentPassword" label="Current password" value={pwForm.currentPassword}
            onChange={updatePwField('currentPassword')} autoComplete="new-password"
            error={pwErrors.currentPassword} required={false}
          />
          <div className="field-grid cols-2">
            <PasswordInput
              id="newPassword" label="New password" value={pwForm.newPassword}
              onChange={updatePwField('newPassword')} error={pwErrors.newPassword} showRules required={false}
            />
            <PasswordInput
              id="confirmNewPassword" label="Confirm new password" value={pwForm.confirmPassword}
              onChange={updatePwField('confirmPassword')} error={pwErrors.confirmPassword} required={false}
            />
          </div>

          {pwError && <div className="alert alert-error">{pwError}</div>}
        </div>

        {profileMessage && <div className="alert alert-ok" role="status"><b>Saved.</b> {profileMessage}</div>}
        {profileError && <div className="alert alert-error" role="alert">{profileError}</div>}
        <div className="btn-row">
          <button className="btn btn-primary" type="submit" disabled={savingProfile || savingPassword || loading}>
            {savingProfile || savingPassword ? 'Saving\u2026' : 'Save all'}
          </button>
        </div>
        </form>

        {confirming && (
          <ConfirmDialog
            title="Save these changes?"
            confirmLabel="Save changes"
            busy={savingProfile || savingPassword}
            onConfirm={async () => { await saveAll(); setConfirming(null); }}
            onClose={() => setConfirming(null)}
          >
            <p>
              Your name will be saved as <b>{[profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' ')}</b>.
            </p>
            {confirming.changingEmail && (
              <p>
                You are changing the address you sign in with to <b>{profile.email.trim()}</b>.
                We will email a verification link there, and your account stays unverified
                until you open it.
              </p>
            )}
            <p>
              {confirming.changingPassword
                ? 'Your password will be changed as well. You will keep using this session, but you will need the new password the next time you sign in.'
                : 'Your password is not being changed.'}
            </p>
          </ConfirmDialog>
        )}
      </div>
    </>
  );
}