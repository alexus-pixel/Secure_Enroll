import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ROLE_LABELS = { parent: 'Parent / Guardian', registrar: 'Registrar', admin: 'Administrator' };

export function Brand() {
  return (
    <span className="brand">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1E4FA3"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" />
        <path d="M3 7.5V16l9 5 9-5V7.5" />
        <path d="M12 12v9" />
      </svg>
      SecureEnroll
    </span>
  );
}

export default function AppNav({ crumb }) {
  const { user, logout } = useAuth();
  return (
    <nav className="app-nav">
      {crumb ? (
        <div className="crumbs">
          <Link to="/dashboard"><Brand /></Link>
          <span>/</span>
          <Link to="/dashboard" className="muted">Dashboard</Link>
          <span>/</span>
          <b>{crumb}</b>
        </div>
      ) : (
        <Link to="/dashboard"><Brand /></Link>
      )}
      <div className="nav-right">
        <span className={`role-badge role-${user?.role}`}>{ROLE_LABELS[user?.role] || user?.role}</span>
        <span className="user-email">{user?.email}</span>
        <button className="btn-ghost" onClick={logout}>Log out</button>
      </div>
    </nav>
  );
}