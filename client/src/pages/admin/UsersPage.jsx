import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { getUsers, getUserCounts, getRoles, createUser, setUserActive } from '../../api/admin';
import UserFormModal from './UserFormModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import PasswordInput from '../../components/PasswordInput';
import Pagination, { usePagination } from '../../components/Pagination';
import ColumnFilterIcon from './ColumnFilterIcon';
import useAutoRefresh, { useAlive, keepIfSame } from '../../hooks/useAutoRefresh';

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
  // The administrator's own password, asked for before an account is switched
  // on or off. It is cleared whenever the dialog closes.
  const [togglePassword, setTogglePassword] = useState('');
  const [toggleError, setToggleError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useAlive();
  const pager = usePagination(users);
  // "No users found" and "nothing matches what you asked for" read the same on
  // an empty table, so the message says which one it is.
  const hasFilter = Boolean(filters.search || filters.role || filters.status || filters.lastLoginFrom || filters.lastLoginTo);

  const load = useCallback(() => {
    getUsers(filters).then((r) => { if (alive.current) setUsers((prev) => keepIfSame(prev, r.users)); })
      .catch((err) => { if (alive.current) setError(err.response?.data?.message || 'Could not load users.'); });
    getUserCounts().then((c) => { if (alive.current) setCounts((prev) => keepIfSame(prev, c)); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.role, filters.status, filters.lastLoginFrom, filters.lastLoginTo]);

  useEffect(() => { getRoles().then(setRoles).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  // Another administrator may add or disable an account while this list is
  // open, so it re-reads itself rather than waiting for a reload. It holds off
  // while the Add User form or a confirmation is open: reloading the rows
  // underneath them would be no help to anyone mid-decision.
  useAutoRefresh(load, { paused: addingUser || Boolean(togglingUser) });

  const closeToggle = useCallback(() => {
    setTogglingUser(null);
    setTogglePassword('');
    setToggleError('');
  }, []);

  async function handleCreate(form) {
    const created = await createUser(form);
    setAddingUser(false);
    // The account exists either way, but it is unusable until its owner opens
    // the link, so a mail provider that refused the message is not something to
    // leave the admin to discover from the person it was sent to.
    setNotice(created?.verificationSent === false
      ? `Account created, but the verification email to ${form.email} could not be sent. They cannot set a password until it reaches them — try again from Forgot password, or check the mail settings.`
      : `Account created. A verification link has been emailed to ${form.email}; they set their own password from it.`);
    load();
  }

  async function handleToggleActive() {
    if (!togglePassword) { setToggleError('Enter your password to confirm.'); return; }
    setToggleBusy(true);
    setError('');
    setNotice('');
    setToggleError('');
    try {
      await setUserActive(togglingUser.id, !togglingUser.is_active, togglePassword);
      closeToggle();
      load();
    } catch (err) {
      const status = err.response?.status;
      const message = err.response?.data?.message || 'Could not change that account.';
      if (status === 401 || status === 400 || status === 429) {
        // A wrong or missing password: stay in the dialog so it can be retyped.
        setToggleError(message);
        setTogglePassword('');
      } else {
        setError(message);
        closeToggle();
      }
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
        <button className="btn btn-primary" onClick={() => { setNotice(''); setAddingUser(true); }}>+ Add User</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && (
        <div className="alert" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>{notice}</div>
      )}

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

        <div className="table-wrap table-wrap-filters">
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
                        {/* An account is either switched on or switched off, and
                            that is the only thing an administrator filters by
                            here. A lockout is temporary and clears itself, so it
                            is still shown in the Status cell but is not worth a
                            filter of its own. */}
                        <option value="">All</option>
                        <option value="active">Active</option>
                        <option value="disabled">Deactivated</option>
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
                      <span className="pill pill-draft">Deactivated</span>
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
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: '28px 12px' }}>
                    {hasFilter ? 'No users match this filter.' : 'No users found.'}
                  </td>
                </tr>
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
          disabled={!togglePassword}
          onConfirm={handleToggleActive}
          onClose={closeToggle}
        >
          <p><b>{togglingUser.email}</b></p>
          <p>
            {togglingUser.is_active
              ? 'They will be signed out and will not be able to sign in again until the account is activated. Nothing they have already done is removed.'
              : 'They will be able to sign in again with their existing password.'}
          </p>
          <p>This is a sensitive action. Enter <b>your own</b> administrator password to confirm it.</p>
          <div onKeyDown={(e) => { if (e.key === 'Enter' && togglePassword && !toggleBusy) handleToggleActive(); }}>
            <PasswordInput
              id="confirm_admin_password" label="Your password" value={togglePassword}
              onChange={(e) => { setTogglePassword(e.target.value); setToggleError(''); }}
              autoComplete="current-password" error={toggleError}
            />
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
