import { useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, GraduationCap, CalendarDays, ScrollText, Settings, School, BarChart3, UserPlus,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Brand } from '../../components/AppNav';
import './admin.css';

const NAV_ITEMS = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/users', label: 'User Management', icon: Users },
  { to: '/admin/teachers', label: 'Teachers', icon: GraduationCap },
  { to: '/admin/schedules', label: 'Class Schedules', icon: CalendarDays },
  { to: '/admin/walk-in-enrollment', label: 'Walk-in Enrollment', icon: UserPlus },
  { to: '/admin/audit-log', label: 'Audit Log', icon: ScrollText },
  { to: '/admin/system-settings', label: 'System Settings', icon: Settings },
  { to: '/admin/school-settings', label: 'School Settings', icon: School },
  { to: '/admin/reports', label: 'Reports & Export', icon: BarChart3 },
];

// Covers every route that has one fixed name. The three detail
// routes (a specific teacher's schedule, their assignments editor,
// one grade level's weekly schedule) don't have a fixed name — each
// of those pages calls setCrumb() from useOutletContext() once it
// knows its own title (e.g. the teacher's name), same idea as the
// reference screens showing "SecureEnroll > Bautista, Nico" instead
// of a generic label.
const STATIC_CRUMBS = {
  '/admin/dashboard': 'Dashboard',
  '/admin/users': 'User Management',
  '/admin/teachers': 'Teachers',
  '/admin/schedules': 'Class Schedules',
  '/admin/walk-in-enrollment': 'Walk-in Enrollment',
  '/admin/audit-log': 'Audit Log',
  '/admin/system-settings': 'System Settings',
  '/admin/school-settings': 'School Settings',
  '/admin/reports': 'Reports & Export',
};

// "fiona.jarder@ucc.edu.ph" -> "Fiona". This is a stand-in until
// full_name is plumbed through the login response itself (the
// column exists after the admin migration, but the original login
// endpoint predates it and doesn't select or return it yet).
function displayNameFromEmail(email) {
  if (!email) return '';
  const local = email.split('@')[0];
  const first = local.split(/[._-]/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [dynamicCrumb, setDynamicCrumb] = useState('');

  const crumb = STATIC_CRUMBS[location.pathname] ?? dynamicCrumb;
  const displayName = user?.full_name || displayNameFromEmail(user?.email);
  const initial = displayName ? displayName[0].toUpperCase() : '?';

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link to="/admin/dashboard" className="admin-sidebar-brand">
          <Brand />
        </Link>
        <nav className="admin-sidebar-nav">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `admin-sidebar-link${isActive ? ' is-active' : ''}`}
            >
              <Icon size={18} strokeWidth={2} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="admin-content">
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <span className="role-badge role-admin">Administrator</span>
            <nav className="breadcrumb" aria-label="Breadcrumb">
              <span>SecureEnroll</span>
              {crumb && (
                <>
                  <span className="crumb-sep">&rsaquo;</span>
                  <span className="crumb-current">{crumb}</span>
                </>
              )}
            </nav>
          </div>
          <div className="admin-topbar-right">
            <span className="welcome-text">Welcome, {displayName}!</span>
            <span className="avatar-circle">{initial}</span>
            <button className="btn btn-secondary btn-sm" onClick={logout}>Log out</button>
          </div>
        </header>
        <main className="admin-main">
          <Outlet context={{ setCrumb: setDynamicCrumb }} />
        </main>
      </div>
    </div>
  );
}