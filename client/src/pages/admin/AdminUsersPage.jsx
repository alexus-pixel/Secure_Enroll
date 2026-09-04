import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getUsers, getRoles, createUser, updateUserRole, setUserActive, getAuditLogs } from '../../api/admin';
import { getSchoolYears, getGradeLevels, getSections } from '../../api/admin';
import { STAFF_ACCOUNT_OPTIONS } from '../../constants/adminOptions';

const ROLE_PILL = { admin: 'pill-admin', registrar: 'pill-registrar', parent: 'pill-parent' };
const ROLE_LABEL = { admin: 'Administrator', registrar: 'Registrar', parent: 'Parent' };
const EMPTY_FORM = { fullName: '', email: '', password: '', roleId: '' };

// This page combines what used to be two separate pages (User Management
// and Audit Log) into one, to match the reference — the reference shows
// no separate audit-log route, just both sections stacked on /admin/users.

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [search, setSearch] = useState('');
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({ activeYear: '—', gradeLevels: 0, sections: 0 });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [dbError, setDbError] = useState('');

  // Surfaces the real backend error message on the page itself, rather
  // than failing silently — makes it obvious whether this is an empty
  // database (fine) or a real API/column-mismatch error (needs fixing).
  function describeError(err, what) {
    const status = err?.response?.status;
    const serverMsg = err?.response?.data?.error || err?.response?.data?.message;
    return `Failed to load ${what}${status ? ` (HTTP ${status})` : ''}${serverMsg ? `: ${serverMsg}` : '.'}`;
  }

  async function loadUsers() {
    try {
      const data = await getUsers({ search: search || undefined });
      setUsers(data.users);
    } catch (err) {
      setDbError(describeError(err, 'users'));
    }
  }

  async function loadStats() {
    try {
      const [years, grades, sections] = await Promise.all([getSchoolYears(), getGradeLevels(), getSections()]);
      const active = years.find((y) => y.is_active);
      setStats({
        activeYear: active ? active.year_label : 'None set',
        gradeLevels: grades.length,
        sections: sections.length,
      });
    } catch (err) {
      setDbError(describeError(err, 'school year stats'));
    }
  }

  async function loadLogs() {
    try {
      const data = await getAuditLogs({ limit: 10 });
      setLogs(data.logs);
    } catch (err) {
      setDbError(describeError(err, 'audit log'));
    }
  }

  useEffect(() => {
    getRoles().then(setRoles).catch(() => {});
    loadStats();
    loadLogs();
  }, []);

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

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
      <div className="admin-stats-bar">
        <span>
          <strong>Active School Year:</strong> {stats.activeYear} &middot; {stats.gradeLevels} Grade Levels &middot; {stats.sections} Sections
        </span>
        <Link to="/admin/settings">Manage Settings &rarr;</Link>
      </div>

      {dbError && (
        <p className="admin-error" style={{
          background: '#3f1d1d', border: '1px solid #7f1d1d', borderRadius: 8,
          padding: '10px 14px', marginBottom: 16,
        }}>
          {dbError}
        </p>
      )}

      <div className="admin-section-header">
        <h1 className="admin-section-title">User Accounts</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="text"
            placeholder="Search by name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="admin-search-input"
            style={{ margin: 0 }}
          />
          <button className="admin-btn" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Cancel' : '+ Add User'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="admin-card">
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
            <select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} required>
              <option value="">Select role</option>
              {roles.filter((r) => r.name !== 'parent').map((r) => (
                <option key={r.id} value={r.id}>{ROLE_LABEL[r.name] || r.name}</option>
              ))}
            </select>
            <button type="submit" className="admin-btn">Create account</button>
          </form>
        </div>
      )}

      {error && <p className="admin-error">{error}</p>}

      <div className="admin-card">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={{ fontWeight: 600 }}>{u.full_name}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{u.email}</td>
                <td>
                  <select
                    value={u.role_id}
                    onChange={(e) => handleRoleChange(u.id, e.target.value)}
                    style={{ background: 'transparent', border: 'none', color: 'inherit' }}
                  >
                    {roles.map((r) => (
                      <option key={r.id} value={r.id} style={{ color: '#000' }}>{ROLE_LABEL[r.name] || r.name}</option>
                    ))}
                  </select>
                  <span className={`pill ${ROLE_PILL[u.role] || 'pill-parent'}`} style={{ marginLeft: 4 }}>
                    {ROLE_LABEL[u.role] || u.role}
                  </span>
                </td>
                <td>
                  <span className={u.is_active ? 'pill pill-active' : 'pill pill-disabled'}>
                    {u.is_active ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td>
                  <button className="link-action" onClick={() => handleToggleActive(u.id, u.is_active)}>
                    {u.is_active ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={5} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No users found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="admin-section-title">Audit Log</h2>
      <div className="admin-card">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User</th>
              <th>Action</th>
              <th>IP Address</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {new Date(log.created_at).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
                  })}
                </td>
                <td>{log.user_email || 'system'}</td>
                <td>
                  <span className={`action-code ${log.action?.includes('FAILED') ? 'action-failed' : 'action-success'}`}>
                    {log.action}
                  </span>
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>{log.ip_address}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={4} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No activity yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}