import { Outlet, Link } from 'react-router-dom';
// ASSUMPTION: useAuth exposes { user, logout }, and user.role is a string
// like 'admin', 'registrar', 'parent' (matching the field name we confirmed
// in AuthContext.jsx — data.user).
import { useAuth } from '../../context/AuthContext';
import './AdminLayout.css';

const ROLE_LABEL = { admin: 'Administrator', registrar: 'Registrar', parent: 'Parent' };
const ROLE_BADGE_CLASS = { admin: 'role-badge-admin', registrar: 'role-badge-registrar', parent: 'role-badge-parent' };

export default function AdminLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <Link to="/admin/users" className="admin-brand">
          <span className="admin-brand-icon">CE</span>
          Caloocan Elementary School
        </Link>
        <div className="admin-header-right">
          <span className={`role-badge ${ROLE_BADGE_CLASS[user?.role] || 'role-badge-parent'}`}>
            {(ROLE_LABEL[user?.role] || user?.role || '').toUpperCase()}
          </span>
          <span className="admin-header-email">{user?.email}</span>
          <button className="admin-btn admin-btn-outline" onClick={logout}>Log out</button>
        </div>
      </header>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}