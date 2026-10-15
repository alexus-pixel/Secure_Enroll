import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ClipboardList, Settings, CalendarDays, UserPlus, Hash, LayoutDashboard, Users, GraduationCap,
  ScrollText, School, BarChart3, Menu, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

const ROLE_LABELS = { parent: 'Parent / Guardian', registrar: 'Registrar', admin: 'Administrator' };

function Mark({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" />
      <path d="M3 7.5V16l9 5 9-5V7.5" />
      <path d="M12 12v9" />
    </svg>
  );
}

function HamburgerIcon({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

export function Brand() {
  return (
    <span className="brand">
      <Mark />
      SecureEnroll
    </span>
  );
}

// One navigation list per role. Every portal (parent, registrar, admin)
// renders this same sidebar, so the look and behaviour never drift apart.
// `also` lists extra path prefixes that should keep the item highlighted
// (for example an application's detail page highlights "Applications").
const NAV_ITEMS = {
  parent: [
    { to: '/dashboard', label: 'Enrollment Applications', icon: ClipboardList, also: ['/applications'] },
    { to: '/settings', label: 'Account Settings', icon: Settings },
    { to: '/schedule', label: "Student's Schedule", icon: CalendarDays },
  ],
  registrar: [
    { to: '/registrar', label: 'Applications', icon: ClipboardList, exact: true, also: ['/registrar/applications'] },
    { to: '/registrar/walk-in', label: 'Walk-in Enrollment', icon: UserPlus },
    { to: '/registrar/missing-lrn', label: 'Missing LRN', icon: Hash },
    { to: '/registrar/settings', label: 'Account Settings', icon: Settings },
  ],
  admin: [
    { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/admin/users', label: 'User Management', icon: Users },
    { to: '/admin/teachers', label: 'Teachers', icon: GraduationCap },
    { to: '/admin/schedules', label: 'Class Schedules', icon: CalendarDays },
    { to: '/admin/walk-in-enrollment', label: 'Walk-in Enrollment', icon: UserPlus },
    { to: '/admin/audit-log', label: 'Audit Log', icon: ScrollText },
    { to: '/admin/system-settings', label: 'System Settings', icon: Settings },
    { to: '/admin/school-settings', label: 'School Settings', icon: School },
    { to: '/admin/reports', label: 'Reports & Export', icon: BarChart3 },
  ],
};

function isActive(item, pathname) {
  const under = (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (item.exact ? pathname === item.to : under(item.to)) return true;
  return (item.also || []).some(under);
}

// "fiona.jarder@ucc.edu.ph" -> "Fiona", for accounts with no name on file.
function nameFromEmail(email) {
  const first = (email || '').split('@')[0].split(/[._-]/)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : '';
}

// crumbs: [{ label, to? }, ...] — the last item (no `to`) renders as the
// current page. For the common "Dashboard > X" case, pass the shorthand
// `crumb="X"` instead and this builds that two-item trail automatically.
export default function AppNav({ crumb, crumbs }) {
  const { user, logout, updateUser } = useAuth();
  const location = useLocation();
  const role = user?.role;
  const navItems = NAV_ITEMS[role] || [];
  const homePath = navItems[0]?.to || '/';
  const items = crumbs || (crumb ? [{ label: 'Dashboard', to: homePath }, { label: crumb }] : null);
  const displayName = user?.firstName || user?.full_name?.split(' ')[0] || nameFromEmail(user?.email) || 'there';
  const initial = displayName.trim().charAt(0).toUpperCase() || '?';

  // Collapsed (icon-only) vs expanded (icon + label) is a per-browser
  // preference, not per-page state, so it lives in localStorage. The CSS
  // variable is what actually resizes everything (sidebar, topbar,
  // container, the banner) at once, since they all read var(--sidebar-w).
  const [expanded, setExpanded] = useState(() => localStorage.getItem('sidebarExpanded') === 'true');
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', expanded ? '220px' : '84px');
    localStorage.setItem('sidebarExpanded', String(expanded));
  }, [expanded]);

  // On phones the sidebar is a slide-in drawer opened from the topbar.
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const [toast, setToast] = useState(null); // { text, tone: 'success' | 'error' }

  // A locally-cached session can be stale (e.g. verified in another tab
  // since last login, or the name was just edited), so refresh it whenever
  // the shell mounts rather than trusting only what's in localStorage. If
  // that reveals the account just became verified, show a one-time toast.
  useEffect(() => {
    const wasVerified = user?.emailVerified;
    api.get('/auth/me').then(({ data }) => {
      updateUser(data);
      if (role === 'parent' && !wasVerified && data.emailVerified) {
        setToast({ text: 'Your email is now verified.', tone: 'success' });
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const [resendState, setResendState] = useState('idle'); // idle | sending | sent
  async function resendVerification() {
    setResendState('sending');
    try {
      await api.post('/auth/resend-verification');
      setResendState('sent');
    } catch (err) {
      setResendState('idle');
      setToast({
        text: err.response?.data?.message || 'Could not resend the email — try again in a moment.',
        tone: 'error',
      });
    }
  }

  return (
    <>
      <aside className={`sidebar${expanded ? ' expanded' : ''}${mobileOpen ? ' mobile-open' : ''}`} aria-label="Main navigation">
        <button type="button" className="sidebar-brand" onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse menu' : 'Expand menu'} aria-expanded={expanded}>
          <span className="sidebar-brand-icon sidebar-brand-icon-default"><Mark size={26} /></span>
          <span className="sidebar-brand-icon sidebar-brand-icon-hover"><HamburgerIcon size={26} /></span>
        </button>
        <span className="sidebar-mobile-brand"><Brand /></span>
        <button type="button" className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close menu">
          <X size={22} />
        </button>
        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item, location.pathname);
            return (
              <Link key={item.to} to={item.to} className={`sidebar-icon${active ? ' active' : ''}`}
                aria-label={item.label} aria-current={active ? 'page' : undefined} title={item.label}
                onClick={() => setMobileOpen(false)}>
                <Icon size={22} strokeWidth={2} />
                <span className="sidebar-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-hidden="true" />}

      <header className="topbar">
        <div className="topbar-left">
          <button type="button" className="nav-toggle" onClick={() => setMobileOpen(true)}
            aria-label="Open menu" aria-expanded={mobileOpen}>
            <Menu size={22} />
          </button>
          <span className={`role-badge role-${role}`}>
            <span className="role-badge-prefix">Logged in as: </span>{ROLE_LABELS[role] || role}
          </span>
          {items && (
            <div className="crumbs">
              {items.map((c, i) => (
                <span key={`${c.label}-${i}`} className="crumb-item">
                  {i > 0 && <span className="crumb-sep">&gt;</span>}
                  {c.to ? <Link to={c.to} className="crumb-link">{c.label}</Link> : <b>{c.label}</b>}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="topbar-right">
          <span className="welcome">Welcome, {displayName}!</span>
          <span className="avatar" aria-hidden="true">{initial}</span>
          <button className="btn-ghost" onClick={logout}>Log out</button>
        </div>
      </header>

      {role === 'parent' && user.emailVerified === false && (
        <div className="verify-banner">
          <span>Please verify your email address to submit enrollment applications.</span>
          {resendState === 'sent' ? (
            <span className="verify-banner-sent">Verification email sent &mdash; check your inbox.</span>
          ) : (
            <button className="btn-ghost btn-sm" onClick={resendVerification} disabled={resendState === 'sending'}>
              {resendState === 'sending' ? 'Sending…' : 'Resend email'}
            </button>
          )}
        </div>
      )}
      {toast && (
        <div className={`toast toast-${toast.tone}`} role="status">{toast.text}</div>
      )}
    </>
  );
}