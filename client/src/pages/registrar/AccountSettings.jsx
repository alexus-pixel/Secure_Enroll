import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';
import PasswordInput from '../../components/PasswordInput';
import ConfirmDialog from '../../components/ConfirmDialog';
import Toast from '../../components/Toast';
import {
  validateName, validateInitial, validatePassword, validateConfirmPassword,
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
  });
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  // Shown for a few seconds at the top of the screen once a save goes through.
  const [toast, setToast] = useState(null);

  // What is actually on file, so nothing starts blank just because the saved
  // sign-in details in this browser are older than the account.
  useEffect(() => {
    api.get('/auth/me')
      .then(({ data }) => setProfile({
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        middleInitial: data.middleName || '',
      }))
      .catch(() => {});
  }, []);

  /**
   * One button saves the page. The name fields may not be left blank. The
   * three password boxes are optional together: empty means "keep my
   * password", and filling any one of them makes all three required.
   */
  const [confirming, setConfirming] = useState(null);

  // The button asks first; the save itself runs once that is answered.
  function askToSave(e) {
    e.preventDefault();
    setNotice(null);

    const changingPassword = Boolean(pw.current || pw.next || pw.confirm);
    const found = {
      firstName: validateName(profile.firstName, { label: 'First name' }),
      lastName: validateName(profile.lastName, { label: 'Last name' }),
      middleInitial: validateInitial(profile.middleInitial),
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
    setConfirming({ changingPassword });
  }

  async function saveAll() {
    const changingPassword = Boolean(confirming && confirming.changingPassword);
    setSaving(true);
    const done = [];
    let failed = '';
    try {
      const { data } = await api.patch('/registrar/profile', {
        firstName: profile.firstName.trim(),
        lastName: profile.lastName.trim(),
        middleInitial: profile.middleInitial.trim(),
      });
      updateUser({ firstName: data.firstName, lastName: data.lastName, middleName: data.middleName });
      done.push('Profile');
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
    setNotice({ type: 'ok', text: `Saved. ${what} updated.` });
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
      <p className="reg-subtitle">Update your name and password</p>

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
          <input id="reg-email" className="reg-input" value={user?.email || ''} disabled />
        </div>
      </div>

      <div className="reg-card">
        <p className="reg-card-title">Change Password</p>
        <p className="reg-help">Leave these three boxes empty to keep your current password.</p>
        <PasswordInput
          {...REG_FIELD}
          id="reg-cur" label="Current password" autoComplete="current-password"
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
