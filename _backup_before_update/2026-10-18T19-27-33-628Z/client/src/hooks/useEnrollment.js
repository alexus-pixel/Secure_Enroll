import { useEffect, useState } from 'react';
import api from '../api/client';

const longDate = (ymd) => new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' })
  .format(new Date(`${ymd}T00:00:00Z`));

// The same enrollment status the landing page shows (open, opens soon, closed),
// straight from the server. The server also refuses applications while it is
// closed, so this is only the friendly side of the same rule.
export default function useEnrollment() {
  const [state, setState] = useState({ loading: true, enrollment: null });

  useEffect(() => {
    let alive = true;
    const load = () => api.get('/public/enrollment')
      .then(({ data }) => alive && setState({ loading: false, enrollment: data.enrollment }))
      .catch(() => alive && setState((s) => ({ ...s, loading: false })));
    load();
    // Pick up the admin opening or closing enrollment while this page stays open.
    const onFocus = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    const timer = setInterval(onFocus, 30000);
    return () => {
      alive = false; clearInterval(timer);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const e = state.enrollment;
  // If the status could not be loaded, do not lock parents out: the server still enforces it.
  const isClosed = Boolean(e && e.state !== 'open');
  const year = e?.schoolYear ? e.schoolYear.replace('-', '–') : '';

  let title = '';
  let message = '';
  if (e) {
    if (e.state === 'open') {
      title = 'Enrollment is open';
      message = `School Year ${year}: until ${longDate(e.closesOn)}${e.daysLeft === 0 ? ' (last day today)' : e.daysLeft > 0 ? ` (${e.daysLeft} ${e.daysLeft === 1 ? 'day' : 'days'} left)` : ''}.`;
    } else if (e.state === 'upcoming') {
      title = 'Enrollment is closed for now';
      message = `Enrollment for School Year ${year} opens on ${longDate(e.opensOn)}. The application form will be available then.`;
    } else if (e.state === 'closed' && e.reason === 'ended') {
      title = 'Enrollment is closed';
      message = `Enrollment for School Year ${year} ended on ${longDate(e.closesOn)}. The application form is turned off.`;
    } else if (e.state === 'closed') {
      title = 'Enrollment is closed';
      message = `Enrollment for School Year ${year} is not open right now. The application form will be available again when the school opens enrollment.`;
    } else {
      title = 'Enrollment is closed';
      message = 'The school has not opened enrollment yet. The application form will be available when it does.';
    }
  }

  return { ...state, isClosed, isOpen: e?.state === 'open', title, message };
}
