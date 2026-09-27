import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

const ROLE_LABELS = { parent: 'Parent / Guardian', registrar: 'Registrar', admin: 'Administrator' };

function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" />
      <path d="M3 7.5V16l9 5 9-5V7.5" />
      <path d="M12 12v9" />
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

function ApplicationsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="7" y1="9" x2="17" y2="9" />
      <line x1="7" y1="13" x2="17" y2="13" />
      <line x1="7" y1="17" x2="13" y2="17" />
    </svg>
  );
}

function GearIcon() {
  const ticks = Array.from({ length: 8 });
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
      {ticks.map((_, i) => (
        <line key={i} x1="12" y1="2.75" x2="12" y2="5.25" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" transform={`rotate(${i * 45} 12 12)`} />
      ))}
      <circle cx="12" cy="12" r="6.25" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2.15" fill="currentColor" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <line x1="3" y1="9.5" x2="21" y2="9.5" />
      <line x1="8" y1="2.5" x2="8" y2="6.5" />
      <line x1="16" y1="2.5" x2="16" y2="6.5" />
    </svg>
  );
}

// crumbs: [{ label, to? }, ...] — the last item (no `to`) renders as the
// current page. For the common "Dashboard > X" case, pass the shorthand
// `crumb="X"` instead and this builds that two-item trail automatically.
export default function AppNav({ crumb, crumbs }) {
  const { user, logout, updateUser } = useAuth();
  const location = useLocation();
  const onSettings = location.pathname.startsWith('/settings');
  const onSchedule = location.pathname.startsWith('/schedule');
  const items = crumbs || (crumb ? [{ label: 'Dashboard', to: '/dashboard' }, { label: crumb }] : null);
  const initial = (user?.firstName || user?.email || '?').trim().charAt(0).toUpperCase();

  // Collapsed (icon-only) vs expanded (icon + label) is a per-browser
  // preference, not per-page state -- AppNav remounts on every navigation,
  // so this has to live somewhere that survives that, hence localStorage
  // instead of a plain useState default. The CSS variable is what actually
  // resizes everything (sidebar, topbar, container, the banner) at once,
  // since they all read var(--sidebar-w) already.
  const [expanded, setExpanded] = useState(() => localStorage.getItem('sidebarExpanded') === 'true');
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', expanded ? '220px' : '84px');
    localStorage.setItem('sidebarExpanded', String(expanded));
  }, [expanded]);

  // A locally-cached session can be stale (e.g. verified in another tab
  // since last login), so refresh the verified flag whenever the shell
  // mounts rather than trusting only what's in localStorage.
  useEffect(() => {
    api.get('/auth/me').then(({ data }) => updateUser(data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [resendState, setResendState] = useState('idle'); // idle | sending | sent
  async function resendVerification() {
    setResendState('sending');
    try {
      await api.post('/auth/resend-verification');
      setResendState('sent');
    } catch {
      setResendState('idle');
    }
  }

  return (
    <>
      <aside className={`sidebar${expanded ? ' expanded' : ''}`}>
        <button type="button" className="sidebar-brand" onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse menu' : 'Expand menu'} aria-expanded={expanded}>
          <Mark />
        </button>
        <nav className="sidebar-nav">
          <Link to="/dashboard" className={`sidebar-icon${!onSettings && !onSchedule ? ' active' : ''}`}
            aria-label="Enrollment Applications" title="Enrollment Applications">
            <ApplicationsIcon />
            {expanded && <span className="sidebar-label">Enrollment Applications</span>}
          </Link>
          <Link to="/settings" className={`sidebar-icon${onSettings ? ' active' : ''}`}
            aria-label="Account Settings" title="Account Settings">
            <GearIcon />
            {expanded && <span className="sidebar-label">Account Settings</span>}
          </Link>
          <Link to="/schedule" className={`sidebar-icon${onSchedule ? ' active' : ''}`}
            aria-label="Student's Schedule" title="Student's Schedule">
            <CalendarIcon />
            {expanded && <span className="sidebar-label">Student&rsquo;s Schedule</span>}
          </Link>
        </nav>
      </aside>

      <header className="topbar">
        <div className="topbar-left">
          <span className={`role-badge role-${user?.role}`}>
            Logged in as: {ROLE_LABELS[user?.role] || user?.role}
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
          <span className="welcome">Welcome, {user?.firstName || 'there'}!</span>
          <span className="avatar" aria-hidden="true">{initial}</span>
          <button className="btn-ghost" onClick={logout}>Log out</button>
        </div>
      </header>

      {user && user.emailVerified === false && (
        <div className="verify-banner">
          <span>Please verify your email address to submit enrollment applications.</span>
          {resendState === 'sent' ? (
            <span className="verify-banner-sent">Verification email sent &mdash; check your inbox.</span>
          ) : (
            <button className="btn-ghost btn-sm" onClick={resendVerification} disabled={resendState === 'sending'}>
              {resendState === 'sending' ? 'Sending\u2026' : 'Resend email'}
            </button>
          )}
        </div>
      )}
    </>
  );
}
