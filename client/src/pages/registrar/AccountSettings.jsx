import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';
import PasswordInput from '../../components/PasswordInput';
import ConfirmDialog from '../../components/ConfirmDialog';
import Toast from '../../components/Toast';
import {
  validateName, validateInitial, validatePassword, validateConfirmPassword, validateEmail,
} from '../../utils/validators';

const INITIAL_MAX = 2;

// The registrar portal has its own field styling; PasswordInput takes the
// class names so the eye button behaves the same here as everywhere else.
const REG_FIELD = {
  fieldClassName: 'reg-field',
  inputClassName: 'reg-input',
  labelClassName: '',
  errorClassName: 'dv-error',
  hintClassName: 'reg-help',
  required: false,
};

export default function AccountSettings() {
  const { user, updateUser } = useAuth();
  const [saving, setSaving] = useState(false);

  // The boxes start with what is on file, so leaving one alone keeps it.
  const [profile, setProfile] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    middleInitial: user?.middleName || '',
    email: user?.email || '',
  });
  // The address as it stands on the account, kept apart from the box so the
  // page can tell whether it is actually being changed.
  const [emailOnFile, setEmailOnFile] = useState(user?.email || '');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  // Shown for a few seconds at the top of the screen once a save goes through.
  const [toast, setToast] = useState(null);

  // What is actually on file, so nothing starts blank just because the saved
  // sign-in details in this browser are older than the account.
  useEffect(() => {
    api.get('/auth/me')
      .then(({ data }) => {
        setEmailOnFile(data.email || '');
        setProfile({
          firstName: data.firstName || '',
          lastName: data.lastName || '',
          middleInitial: data.middleName || '',
          email: data.email || '',
        });
      })
      .catch(() => {});
  }, []);

  /**
   * One button saves the page. The name fields may not be left blank. The
   * password boxes are optional: leaving the new-password boxes empty means
   * "keep my password", and filling either of them makes all three required.
   */
  const [confirming, setConfirming] = useState(null);

  // The button asks first; the save itself runs once that is answered.
  function askToSave(e) {
    e.preventDefault();
    setNotice(null);

    // A password change is only meant when a NEW password has been typed. The
    // current-password box alone does not count: browsers fill it in by
    // themselves with the saved password, and that must not stop a name or
    // email change from being saved.
    const changingPassword = Boolean(pw.next || pw.confirm);
    const found = {
      firstName: validateName(profile.firstName, { label: 'First name' }),
      lastName: validateName(profile.lastName, { label: 'Last name' }),
      middleInitial: validateInitial(profile.middleInitial),
      // A staff address may sit on the school's own domain, so it is only
      // checked for shape here; the server has the last word on the domain.
      email: validateEmail(profile.email),
      ...(changingPassword ? {
        current: pw.current ? '' : 'Enter your current password.',
        next: validatePassword(pw.next) || (pw.next === pw.current ? 'New password must be different from your current password.' : ''),
        confirm: validateConfirmPassword(pw.next, pw.confirm),
      } : {}),
    };
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      setNotice({ type: 'error', text: 'Please correct the highlighted fields.' });
      return;
    }
    const changingEmail = profile.email.trim().toLowerCase() !== emailOnFile.trim().toLowerCase();
    setConfirming({ changingPassword, changingEmail });
  }

  async function saveAll() {
    const changingPassword = Boolean(confirming && confirming.changingPassword);
    setSaving(true);
    const done = [];
    let failed = '';
    let emailNote = '';
    try {
      // /auth/me saves a staff name to the same columns the registrar's own
      // profile endpoint did, and it is the one endpoint that also handles the
      // sign-in address, so the whole card goes through it.
      const { data } = await api.patch('/auth/me', {
        firstName: profile.firstName.trim(),
        lastName: profile.lastName.trim(),
        middleName: profile.middleInitial.trim(),
        email: profile.email.trim(),
      });
      updateUser({
        firstName: data.firstName, lastName: data.lastName, middleName: data.middleName,
        email: data.email,
      });
      done.push('Profile');
      if (data.emailChanged) {
        setEmailOnFile(data.email || '');
        // The account is unverified again until the link is opened, and the
        // link went to the new address, so both have to be said out loud.
        emailNote = data.verificationSent
          ? ` A verification link has been emailed to ${data.email}. Please open it to confirm your new email address.`
          : ` Your email address is now ${data.email}, but the verification link could not be sent just now.`;
      }
    } catch (err) {
      failed = err.response?.data?.message || 'Could not update your profile.';
    }

    if (!failed && changingPassword) {
      try {
        await api.post('/registrar/password', { current: pw.current, next: pw.next });
        setPw({ current: '', next: '', confirm: '' });
        done.push('password');
      } catch (err) {
        failed = err.response?.data?.message || 'Could not update your password.';
      }
    }
    setSaving(false);
    if (failed) {
      setNotice({ type: 'error', text: failed });
      return;
    }
    const what = done.join(' and ');
    // Said twice on purpose: once where the eye is, and once on the page
    // itself for anyone who looks back after the toast has gone.
    setNotice({ type: 'ok', text: `Saved. ${what} updated.${emailNote}` });
    setToast(`${what} updated.`);
  }

  const field = (key) => ({
    className: `reg-input${errors[key] ? ' input-error' : ''}`,
    'aria-invalid': errors[key] ? 'true' : undefined,
  });

  return (
    <form className="reg-page reg-narrow" onSubmit={askToSave} noValidate>
      <Toast message={toast} onDone={() => setToast(null)} />
      <h1 className="reg-title">Edit Profile</h1>
      <p className="reg-subtitle">Update your name, email address and password</p>

      <div className="reg-card">
        <p className="reg-card-title">Profile</p>
        <div className="reg-row reg-row-profile">
          <div className="reg-field">
            <label htmlFor="reg-first">First name</label>
            <input id="reg-first" {...field('firstName')} autoComplete="off" maxLength={60}
              value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: e.target.value })} />
            {errors.firstName && <div className="dv-error">{errors.firstName}</div>}
          </div>
          <div className="reg-field">
            <label htmlFor="reg-last">Last name</label>
            <input id="reg-last" {...field('lastName')} autoComplete="off" maxLength={60}
              value={profile.lastName} onChange={(e) => setProfile({ ...profile, lastName: e.target.value })} />
            {errors.lastName && <div className="dv-error">{errors.lastName}</div>}
          </div>
          <div className="reg-field">
            <label htmlFor="reg-mi">M.I. (optional)</label>
            <input id="reg-mi" {...field('middleInitial')} autoComplete="off" maxLength={INITIAL_MAX}
              value={profile.middleInitial} onChange={(e) => setProfile({ ...profile, middleInitial: e.target.value })} />
            {errors.middleInitial && <div className="dv-error">{errors.middleInitial}</div>}
          </div>
        </div>
        <div className="reg-field">
          <label htmlFor="reg-email">Email address</label>
          <input id="reg-email" {...field('email')} type="email" autoComplete="email" maxLength={254}
            value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
          {errors.email && <div className="dv-error">{errors.email}</div>}
          <p className="reg-help">
            This is the address you sign in with. Change it and a verification link
            is emailed to the new address; the account counts as unverified until
            that link is opened.
          </p>
        </div>
      </div>

      <div className="reg-card">
        <p className="reg-card-title">Change Password</p>
        <p className="reg-help">Leave the new password boxes empty to keep your current password. You can save your name or email without touching this section.</p>
        <PasswordInput
          {...REG_FIELD}
          id="reg-cur" label="Current password" autoComplete="new-password"
          value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })}
          error={errors.current}
        />
        <div className="reg-row reg-row-2">
          <PasswordInput
            {...REG_FIELD}
            id="reg-new" label="New password"
            value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })}
            error={errors.next} showRules
          />
          <PasswordInput
            {...REG_FIELD}
            id="reg-conf" label="Confirm new password"
            value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            error={errors.confirm}
          />
        </div>
      </div>

      {notice && <div className={`reg-notice reg-notice-${notice.type}`} role="status">{notice.text}</div>}
      <button className="reg-btn reg-btn-blue" type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save all'}
      </button>

      {confirming && (
        <ConfirmDialog
          title="Save these changes?"
          confirmLabel="Save changes"
          busy={saving}
          onConfirm={async () => { await saveAll(); setConfirming(null); }}
          onClose={() => setConfirming(null)}
        >
          <p>
            Your name will be saved as <b>{[profile.firstName, profile.middleInitial, profile.lastName].filter(Boolean).join(' ')}</b>.
          </p>
          {confirming.changingEmail && (
            <p>
              You are changing the address you sign in with to <b>{profile.email.trim()}</b>.
              A verification link will be emailed there, and the account stays unverified
              until it is opened.
            </p>
          )}
          <p>
            {confirming.changingPassword
              ? 'Your password will be changed as well. You will need the new one the next time you sign in.'
              : 'Your password is not being changed.'}
          </p>
        </ConfirmDialog>
      )}
    </form>
  );
}
