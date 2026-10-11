import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

export default function AccountSettings() {
  const { user } = useAuth();

  const [profile, setProfile] = useState({
    firstName: user?.first_name || '',
    lastName: user?.last_name || '',
    middleInitial: user?.middle_initial || '',
  });
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [profileNotice, setProfileNotice] = useState(null);
  const [pwNotice, setPwNotice] = useState(null);

  function saveProfile() {
    if (!profile.firstName.trim() || !profile.lastName.trim()) {
      setProfileNotice({ type: 'error', text: 'First and last name are required.' });
      return;
    }
    // TODO: call API
    setProfileNotice({ type: 'ok', text: 'Profile updated.' });
  }

  function updatePassword() {
    if (!pw.current || !pw.next || !pw.confirm) {
      setPwNotice({ type: 'error', text: 'Please fill in all password fields.' });
    } else if (pw.next.length < 8) {
      setPwNotice({ type: 'error', text: 'New password must be at least 8 characters.' });
    } else if (pw.next !== pw.confirm) {
      setPwNotice({ type: 'error', text: 'New passwords do not match.' });
    } else {
      // TODO: call API
      setPwNotice({ type: 'ok', text: 'Password updated.' });
      setPw({ current: '', next: '', confirm: '' });
    }
  }

  return (
    <div className="reg-page reg-narrow">
      <h1 className="reg-title">Account Settings</h1>
      <p className="reg-subtitle">Update your name and password</p>

      <div className="reg-card">
        <p className="reg-card-title">Profile</p>
        {profileNotice && <div className={`reg-notice reg-notice-${profileNotice.type}`}>{profileNotice.text}</div>}
        <div className="reg-row reg-row-profile">
          <div className="reg-field">
            <label>First name</label>
            <input className="reg-input" autoComplete="off" value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: e.target.value })} />
          </div>
          <div className="reg-field">
            <label>Last name</label>
            <input className="reg-input" autoComplete="off" value={profile.lastName} onChange={(e) => setProfile({ ...profile, lastName: e.target.value })} />
          </div>
          <div className="reg-field">
            <label>M.I</label>
            <input className="reg-input" autoComplete="off" maxLength={2} value={profile.middleInitial} onChange={(e) => setProfile({ ...profile, middleInitial: e.target.value })} />
          </div>
        </div>
        <div className="reg-field">
          <label>Email address</label>
          <input className="reg-input" value={user?.email || ''} disabled />
        </div>
        <button className="reg-btn reg-btn-blue" onClick={saveProfile}>Save Changes</button>
      </div>

      <div className="reg-card">
        <p className="reg-card-title">Change Password</p>
        {pwNotice && <div className={`reg-notice reg-notice-${pwNotice.type}`}>{pwNotice.text}</div>}
        <div className="reg-field">
          <label>Current password</label>
          <input className="reg-input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        </div>
        <div className="reg-row reg-row-2">
          <div className="reg-field">
            <label>New password</label>
            <input className="reg-input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </div>
          <div className="reg-field">
            <label>Confirm new password</label>
            <input className="reg-input" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </div>
        </div>
        <button className="reg-btn reg-btn-blue" onClick={updatePassword}>Update Password</button>
      </div>
    </div>
  );
}