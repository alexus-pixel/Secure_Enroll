import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';
import {
  validateName, validateInitial, validatePassword, validateConfirmPassword,
} from '../../utils/validators';

const INITIAL_MAX = 2;

export default function AccountSettings() {
  const { user, updateUser } = useAuth();
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  const [profile, setProfile] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    middleInitial: user?.middleName || '',
  });
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [profileNotice, setProfileNotice] = useState(null);
  const [pwNotice, setPwNotice] = useState(null);

  async function saveProfile() {
    const problem =
      validateName(profile.firstName, { label: 'First name' }) ||
      validateName(profile.lastName, { label: 'Last name' }) ||
      validateInitial(profile.middleInitial);
    if (problem) {
      setProfileNotice({ type: 'error', text: problem });
      return;
    }
    setSavingProfile(true);
    try {
      const { data } = await api.patch('/registrar/profile', {
        firstName: profile.firstName.trim(),
        lastName: profile.lastName.trim(),
        middleInitial: profile.middleInitial.trim(),
      });
      updateUser({ firstName: data.firstName, lastName: data.lastName, middleName: data.middleName });
      setProfileNotice({ type: 'ok', text: 'Profile updated.' });
    } catch (err) {
      setProfileNotice({ type: 'error', text: err.response?.data?.message || 'Could not update your profile.' });
    } finally {
      setSavingProfile(false);
    }
  }

  async function updatePassword() {
    const problem = !pw.current
      ? 'Enter your current password.'
      : validatePassword(pw.next) || validateConfirmPassword(pw.next, pw.confirm) ||
        (pw.next === pw.current ? 'New password must be different from your current password.' : '');
    if (problem) {
      setPwNotice({ type: 'error', text: problem });
      return;
    }
    setSavingPw(true);
    try {
      await api.post('/registrar/password', { current: pw.current, next: pw.next });
      setPwNotice({ type: 'ok', text: 'Password updated.' });
      setPw({ current: '', next: '', confirm: '' });
    } catch (err) {
      setPwNotice({ type: 'error', text: err.response?.data?.message || 'Could not update your password.' });
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div className="reg-page reg-narrow">
      <h1 className="reg-title">Edit Profile</h1>
      <p className="reg-subtitle">Update your name and password</p>

      <div className="reg-card">
        <p className="reg-card-title">Profile</p>
        {profileNotice && <div className={`reg-notice reg-notice-${profileNotice.type}`}>{profileNotice.text}</div>}
        <div className="reg-row reg-row-profile">
          <div className="reg-field">
            <label htmlFor="reg-first">First name</label>
            <input id="reg-first" className="reg-input" autoComplete="off" maxLength={60} value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: e.target.value })} />
          </div>
          <div className="reg-field">
            <label htmlFor="reg-last">Last name</label>
            <input id="reg-last" className="reg-input" autoComplete="off" maxLength={60} value={profile.lastName} onChange={(e) => setProfile({ ...profile, lastName: e.target.value })} />
          </div>
          <div className="reg-field">
            <label htmlFor="reg-mi">M.I. (optional)</label>
            <input id="reg-mi" className="reg-input" autoComplete="off" maxLength={INITIAL_MAX} value={profile.middleInitial} onChange={(e) => setProfile({ ...profile, middleInitial: e.target.value })} />
          </div>
        </div>
        <div className="reg-field">
          <label htmlFor="reg-email">Email address</label>
          <input id="reg-email" className="reg-input" value={user?.email || ''} disabled />
        </div>
        <button className="reg-btn reg-btn-blue" onClick={saveProfile} disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save Changes'}</button>
      </div>

      <div className="reg-card">
        <p className="reg-card-title">Change Password</p>
        {pwNotice && <div className={`reg-notice reg-notice-${pwNotice.type}`}>{pwNotice.text}</div>}
        <div className="reg-field">
          <label htmlFor="reg-cur">Current password</label>
          <input id="reg-cur" className="reg-input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        </div>
        <div className="reg-row reg-row-2">
          <div className="reg-field">
            <label htmlFor="reg-new">New password</label>
            <input id="reg-new" className="reg-input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </div>
          <div className="reg-field">
            <label htmlFor="reg-conf">Confirm new password</label>
            <input id="reg-conf" className="reg-input" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </div>
        </div>
        <button className="reg-btn reg-btn-blue" onClick={updatePassword} disabled={savingPw}>{savingPw ? 'Saving…' : 'Update Password'}</button>
      </div>
    </div>
  );
}
