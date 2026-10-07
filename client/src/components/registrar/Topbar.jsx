import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

function getCrumbs(pathname) {
  if (pathname.startsWith('/registrar/applications/'))
    return [{ label: 'Dashboard', to: '/registrar' }, { label: 'View' }];
  if (pathname.startsWith('/registrar/walk-in')) return [{ label: 'Walk-in Enrollment' }];
  if (pathname.startsWith('/registrar/settings')) return [{ label: 'Account Settings' }];
  return [];
}

export default function Topbar() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // Adjust these field names once we see your login response
  const name = user?.first_name || user?.name || user?.email || 'User';

  function handleLogout() {
    logout();
    navigate('/');
  }

  return (
    <header className="reg-topbar">
      <div className="reg-topbar-left">
        <span className="reg-role-pill">LOGGED IN AS: REGISTRAR</span>
        <div className="reg-crumbs">
          {getCrumbs(pathname).map((c, i, arr) => (
            <span key={c.label}>
              {c.to ? <Link to={c.to}>{c.label}</Link> : <strong>{c.label}</strong>}
              {i < arr.length - 1 && ' › '}
            </span>
          ))}
        </div>
      </div>

      <div className="reg-topbar-right">
        <span className="reg-welcome">Welcome, {name}!</span>
        <div className="reg-avatar">{name.charAt(0).toUpperCase()}</div>
        <button className="reg-logout" onClick={handleLogout}>Log out</button>
      </div>
    </header>
  );
}