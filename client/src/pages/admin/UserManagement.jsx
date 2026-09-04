import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { getUsers, getRoles, createUser, updateUserRole, setUserActive } from '../../api/admin';
import { STAFF_ACCOUNT_OPTIONS } from '../../constants/adminOptions';

const ROLE_BADGE_CLASS = {
  registrar: 'admin-badge-registrar',
  admin: 'admin-badge-admin',
  parent: 'admin-badge-parent',
};

const EMPTY_FORM = { fullName: '', email: '', password: '', roleId: '' };

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  async function loadUsers() {
    setLoading(true);
    try {
      const data = await getUsers({ search: search || undefined });
      setUsers(data.users);
    } catch (err) {
      setError('Failed to load users.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    getRoles().then(setRoles).catch(() => {});
  }, []);

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Selecting a predefined name auto-fills the matching email so you don't
  // have to type both — pick a different name from the dropdown to change
  // it, or just leave the password field to type since that shouldn't be
  // a predictable predefined value.
  function handleNameSelect(fullName) {
    const match = STAFF_ACCOUNT_OPTIONS.find((o) => o.fullName === fullName);
    setForm({ ...form, fullName, email: match ? match.email : '' });
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await createUser(form);
      setForm(EMPTY_FORM);
      setShowForm(false);
      loadUsers();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to create user.');
    }
  }

  async function handleRoleChange(userId, roleId) {
    await updateUserRole(userId, roleId);
    loadUsers();
  }

  async function handleToggleActive(userId, isActive) {
    await setUserActive(userId, !isActive);
    loadUsers();
  }

  return (
    <div>
      <div className="admin-page-header">
        <h1>User management</h1>
        <button className="admin-btn" onClick={() => setShowForm((s) => !s)}>
          <Plus size={16} strokeWidth={2} />
          {showForm ? 'Cancel' : 'Add staff account'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="admin-form">
          <select value={form.fullName} onChange={(e) => handleNameSelect(e.target.value)} required>
            <option value="">Select name</option>
            {STAFF_ACCOUNT_OPTIONS.map((o) => (
              <option key={o.fullName} value={o.fullName}>{o.fullName}</option>
            ))}
          </select>
          <input type="email" value={form.email} readOnly placeholder="Email (auto-filled)" />
          <input
            type="password"
            placeholder="Temporary password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <select
            value={form.roleId}
            onChange={(e) => setForm({ ...form, roleId: e.target.value })}
            required
          >
            <option value="">Select role</option>
            {/* Assumes parents shouldn't be creatable here since they
                self-register. Adjust the filter if role names differ. */}
            {roles.filter((r) => r.name !== 'parent').map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <button type="submit" className="admin-btn">Create account</button>
        </form>
      )}

      {error && <p className="admin-error">{error}</p>}

      <input
        type="text"
        placeholder="Search by name or email"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="admin-search-input"
      />

      {loading ? (
        <p>Loading users...</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name}</td>
                  <td style={{ color: 'var(--admin-text-secondary)' }}>{u.email}</td>
                  <td>
                    <span className={`admin-badge ${ROLE_BADGE_CLASS[u.role] || 'admin-badge-parent'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td>
                    <span className={`admin-status ${u.is_active ? 'admin-status-active' : 'admin-status-inactive'}`}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ color: 'var(--admin-text-secondary)' }}>
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <select
                      value={u.role_id}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                    <button className="admin-row-btn" onClick={() => handleToggleActive(u.id, u.is_active)}>
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
