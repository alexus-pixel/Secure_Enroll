import { useState } from 'react';

export default function ResetPasswordModal({ user, onClose, onSubmit }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSubmit(password);
    } catch (err) {
      const data = err.response?.data;
      setError(data?.errors?.map((x) => x.message).join(' ') || data?.message || 'Could not reset password.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div className="modal-head">
          <h2>Reset password</h2>
          <button className="btn-ghost" onClick={onClose} type="button">Close</button>
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: -8 }}>For {user.email}</p>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label className="label">New temporary password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <p className="hint">At least 8 characters, with a letter and a number. This also clears any active lockout.</p>
          </div>
          <button className="btn btn-primary" type="submit" disabled={saving} style={{ width: '100%' }}>
            {saving ? 'Saving...' : 'Reset password'}
          </button>
        </form>
      </div>
    </div>
  );
}
