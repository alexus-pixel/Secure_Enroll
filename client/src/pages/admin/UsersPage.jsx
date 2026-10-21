import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { getUsers, getUserCounts, getRoles, createUser, setUserActive } from '../../api/admin';
import UserFormModal from './UserFormModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import Pagination, { usePagination } from '../../components/Pagination';
import ColumnFilterIcon from './ColumnFilterIcon';

const ROLE_LABELS = { parent: 'Parent / Guardian', registrar: 'Registrar', admin: 'Administrator' };

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [counts, setCounts] = useState({ total: 0, parent: 0, registrar: 0, admin: 0 });
  const [roles, setRoles] = useState([]);
  const [filters, setFilters] = useState({ search: '', role: '', status: '', lastLoginFrom: '', lastLoginTo: '' });
  // An administrator may only add an account and turn one on or off.
  // Changing another account's role or password is not offered at all.
  const [addingUser, setAddingUser] = useState(false);
  const [togglingUser, setTogglingUser] = useState(null); // the account being turned on/off
  const [toggleBusy, setToggleBusy] = useState(false);
  const [error, setError] = useState('');
  const pager = usePagination(users);

  const load = useCallback(() => {
    getUsers(filters).then((r) => setUsers(r.users)).catch((err) => setError(err.response?.data?.message || 'Could not load users.'));
    getUserCounts().then(setCounts).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.role, filters.status, filters.lastLoginFrom, filters.lastLoginTo]);

  useEffect(() => { getRoles().then(setRoles).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function handleCreate(form) {
    await createUser(form);
    setAddingUser(false);
    load();
  }

  async function handleToggleActive() {
    setToggleBusy(true);
    setError('');
    try {
      await setUserActive(togglingUser.id, !togglingUser.is_active);
      setTogglingUser(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not change that account.');
      setTogglingUser(null);
    } finally {
      setToggleBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>User Management</h1>
          <p>All roles &middot; SecureEnroll</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAddingUser(true)}>+ Add User</button>
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
              {pager.pageRows.map((u) => (
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
                    <button
                      className="link-action"
                      onClick={() => setTogglingUser(u)}
                    >
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={pager.page} totalPages={pager.totalPages} total={pager.total}
          from={pager.from} to={pager.to} onPage={pager.setPage} label="users"
        />
      </div>

      {addingUser && (
        <UserFormModal roles={roles} onClose={() => setAddingUser(false)} onSubmit={handleCreate} />
      )}

      {togglingUser && (
        <ConfirmDialog
          title={togglingUser.is_active ? 'Deactivate this account?' : 'Activate this account?'}
          confirmLabel={togglingUser.is_active ? 'Deactivate account' : 'Activate account'}
          tone={togglingUser.is_active ? 'danger' : 'primary'}
          busy={toggleBusy}
          onConfirm={handleToggleActive}
          onClose={() => setTogglingUser(null)}
        >
          <p><b>{togglingUser.email}</b></p>
          <p>
            {togglingUser.is_active
              ? 'They will be signed out and will not be able to sign in again until the account is activated. Nothing they have already done is removed.'
              : 'They will be able to sign in again with their existing password.'}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
