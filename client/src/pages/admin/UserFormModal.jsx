import { useState } from 'react';

const ROLE_LABELS = { registrar: 'Registrar', admin: 'Administrator' };

/**
 * One form, two modes — mirrors the flow doc's "reuse the parent
 * registration UI" instruction: same field styling as Register.jsx
 * (.field / .label / .input), with the fields the parent form
 * doesn't need (password on edit) removed rather than duplicated
 * into a second form.
 */
export default function UserFormModal({ mode, user, roles, onClose, onSubmit }) {
  const staffRoles = roles.filter((r) => r.name !== 'parent');
  const [form, setForm] = useState({
    fullName: user?.full_name || '',
    email: user?.email || '',
    password: '',
    roleId: user?.role_id || staffRoles[0]?.id || '',
    isActive: user?.is_active ?? true,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSubmit(form);
    } catch (err) {
      const data = err.response?.data;
      setError(data?.errors?.map((x) => x.message).join(' ') || data?.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 style={{ marginBottom: 2 }}>{mode === 'create' ? 'Add User' : 'Edit User'}</h2>
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Registrar and administrator accounts only.</p>
          </div>
          <button className="btn-ghost" onClick={onClose} type="button">Close</button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label className="label">Full name</label>
            <input
              className="input" value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })} required
            />
          </div>
          <div className="field">
            <label className="label">Email address</label>
            <input
              className="input" type="email" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required disabled={mode === 'edit'}
            />
          </div>
          {mode === 'create' && (
            <div className="field">
              <label className="label">Temporary password</label>
              <input
                className="input" type="password" value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })} required
              />
              <p className="hint">At least 8 characters, with a letter and a number.</p>
            </div>
          )}
          <div className="field-grid cols-2">
            <div>
              <label className="label">Role</label>
              <select
                className="input" value={form.roleId}
                onChange={(e) => setForm({ ...form, roleId: Number(e.target.value) })}
                required
              >
                {staffRoles.map((r) => <option key={r.id} value={r.id}>{ROLE_LABELS[r.name] || r.name}</option>)}
              </select>
            </div>
            {mode === 'edit' && (
              <div>
                <label className="label">Status</label>
                <select
                  className="input" value={form.isActive ? 'active' : 'disabled'}
                  onChange={(e) => setForm({ ...form, isActive: e.target.value === 'active' })}
                >
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            )}
          </div>

          <button className="btn btn-primary" type="submit" disabled={saving} style={{ width: '100%', marginTop: 8 }}>
            {saving ? 'Saving...' : mode === 'create' ? 'Create account' : 'Save changes'}
          </button>
        </form>
      </div>
    </div>
  );
}