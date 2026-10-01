import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import {
  getUsers, getUserCounts, getRoles, createUser, updateUserRole, setUserActive, resetUserPassword,
} from '../../api/admin';
import UserFormModal from './UserFormModal';
import ResetPasswordModal from './ResetPasswordModal';
import ColumnFilterIcon from './ColumnFilterIcon';

const ROLE_LABELS = { parent: 'Parent / Guardian', registrar: 'Registrar', admin: 'Administrator' };

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [counts, setCounts] = useState({ total: 0, parent: 0, registrar: 0, admin: 0 });
  const [roles, setRoles] = useState([]);
  const [filters, setFilters] = useState({ search: '', role: '', status: '', lastLoginFrom: '', lastLoginTo: '' });
  const [editingUser, setEditingUser] = useState(null); // null | 'new' | user object
  const [resettingUser, setResettingUser] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    getUsers(filters).then((r) => setUsers(r.users)).catch((err) => setError(err.response?.data?.message || 'Could not load users.'));
    getUserCounts().then(setCounts).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.role, filters.status, filters.lastLoginFrom, filters.lastLoginTo]);

  useEffect(() => { getRoles().then(setRoles).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function handleCreate(form) {
    await createUser(form);
    setEditingUser(null);
    load();
  }

  async function handleEdit(form) {
    await updateUserRole(editingUser.id, form.roleId);
    await setUserActive(editingUser.id, form.isActive);
    setEditingUser(null);
    load();
  }

  async function handleResetPassword(newPassword) {
    await resetUserPassword(resettingUser.id, newPassword);
    setResettingUser(null);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>User Management</h1>
          <p>All roles &middot; SecureEnroll</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditingUser('new')}>+ Add User</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="admin-stats-row">
        <div className="admin-stat-card"><div className="admin-stat-value">{counts.total}</div><div className="admin-stat-label">Total Users</div></div>
        <div className="admin-stat-card"><div className="admin-stat-value">{counts.parent}</div><div className="admin-stat-label">Parents</div></div>
        <div className="admin-stat-card"><div className="admin-stat-value">{counts.registrar}</div><div className="admin-stat-label">Registrars</div></div>
        <div className="admin-stat-card"><div className="admin-stat-value">{counts.admin}</div><div className="admin-stat-label">Admins</div></div>
      </div>

      <div className="card card-flush">
        <div style={{ padding: 20, paddingBottom: 0 }}>
          <div className="search-box">
            <Search size={15} className="search-box-icon" />
            <input
              className="admin-search-input"
              placeholder="Search by name or email"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </div>
        </div>

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>
                  <span className="th-head"><span className="th-label">Email</span></span>
                </th>
                <th>
                  <span className="th-head">
                    <span className="th-label">Role</span>
                    <ColumnFilterIcon active={!!filters.role}>
                      <label>Role</label>
                      <select
                        className="admin-filter-input"
                        value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })}
                      >
                        <option value="">All</option>
                        <option value="parent">Parent</option>
                        <option value="registrar">Registrar</option>
                        <option value="admin">Admin</option>
                      </select>
                    </ColumnFilterIcon>
                  </span>
                </th>
                <th>
                  <span className="th-head">
                    <span className="th-label">Status</span>
                    <ColumnFilterIcon active={!!filters.status}>
                      <label>Status</label>
                      <select
                        className="admin-filter-input"
                        value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                      >
                        <option value="">All</option>
                        <option value="active">Active</option>
                        <option value="locked">Locked</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </ColumnFilterIcon>
                  </span>
                </th>
                <th>
                  <span className="th-head">
                    <span className="th-label">Last Login</span>
                    <ColumnFilterIcon active={!!filters.lastLoginFrom} align="right">
                      <label>Last login on/after</label>
                      <input
                        type="datetime-local" className="admin-filter-input"
                        value={filters.lastLoginFrom ? filters.lastLoginFrom.slice(0, 16) : ''}
                        onChange={(e) => setFilters({ ...filters, lastLoginFrom: e.target.value ? new Date(e.target.value).toISOString() : '' })}
                      />
                    </ColumnFilterIcon>
                  </span>
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <b>{u.email}</b>
                    {u.full_name && <div className="cell-sub">{u.full_name}</div>}
                  </td>
                  <td>{ROLE_LABELS[u.role] || u.role}</td>
                  <td>
                    {u.is_locked ? (
                      <span className="pill pill-needs_revision">Locked</span>
                    ) : u.is_active ? (
                      <span className="pill pill-approved">Active</span>
                    ) : (
                      <span className="pill pill-draft">Disabled</span>
                    )}
                  </td>
                  <td>
                    {u.last_login_at ? (
                      <>
                        {new Date(u.last_login_at).toLocaleDateString()}
                        <div className="cell-sub">{new Date(u.last_login_at).toLocaleTimeString()}</div>
                      </>
                    ) : '\u2014'}
                  </td>
                  <td>
                    <button className="link-action" onClick={() => setEditingUser(u)} style={{ marginRight: 10 }}>Edit</button>
                    <button className="link-action" onClick={() => setResettingUser(u)}>Reset Password</button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingUser && (
        <UserFormModal
          mode={editingUser === 'new' ? 'create' : 'edit'}
          user={editingUser === 'new' ? null : editingUser}
          roles={roles}
          onClose={() => setEditingUser(null)}
          onSubmit={editingUser === 'new' ? handleCreate : handleEdit}
        />
      )}
      {resettingUser && (
        <ResetPasswordModal user={resettingUser} onClose={() => setResettingUser(null)} onSubmit={handleResetPassword} />
      )}
    </div>
  );
}
