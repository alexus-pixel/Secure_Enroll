import { Link, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { mockApplications } from '../../data/mockApplications';

function getCrumbs(pathname) {
  const view = matchPath('/registrar/applications/:id', pathname);
  if (view) {
    const app = mockApplications.find((a) => String(a.id) === view.params.id);
    const crumbs = [{ label: 'Dashboard', to: '/registrar' }, { label: 'View' }];
    if (app) crumbs.push({ label: app.student, strong: true });
    return crumbs;
  }
  if (pathname.startsWith('/registrar/walk-in')) return [{ label: 'Walk-in Enrollment', strong: true }];
  if (pathname.startsWith('/registrar/settings')) return [{ label: 'Account Settings', strong: true }];
  if (pathname.startsWith('/registrar/missing-lrn')) return [{ label: 'Missing LRN', strong: true }];
  return [];
}

export default function Topbar() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // Adjust these field names once the login response includes the user's name
  const name = user?.first_name || user?.name || user?.email || 'User';

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const crumbs = getCrumbs(pathname);

  return (
    <header className="reg-topbar">
      <div className="reg-topbar-left">
        <span className="reg-role-pill">LOGGED IN AS: REGISTRAR</span>
        <div className="reg-crumbs">
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`}>
              {c.to ? <Link to={c.to}>{c.label}</Link> : c.strong ? <strong>{c.label}</strong> : <span>{c.label}</span>}
              {i < crumbs.length - 1 && <span className="reg-crumb-sep">&rsaquo;</span>}
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