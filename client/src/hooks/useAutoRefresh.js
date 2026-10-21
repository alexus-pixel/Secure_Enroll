import { useEffect, useRef } from 'react';

/**
 * Keeps a page's own data current without the user pressing reload.
 *
 * The admin screens are shared: a registrar approves an application, another
 * administrator adds a user, and this tab would otherwise sit on numbers that
 * are already wrong. There is no live channel from the server, so the page
 * simply re-runs its own loader when the tab is looked at again and every so
 * often while it stays visible. Nothing runs while the tab is hidden, so a
 * forgotten tab does not poll all day.
 *
 * `load` must be stable (useCallback), or every render would tear the interval
 * down and start the countdown over. `paused` is for the moments a refresh
 * would be rude - while a modal or form is open, a reload underneath it would
 * fight whatever the user is typing - so callers pass the open-form flag and
 * the page catches up once it is closed.
 */
export default function useAutoRefresh(load, { interval = 25000, paused = false } = {}) {
  useEffect(() => {
    if (paused) return undefined;
    const refresh = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, interval);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [load, interval, paused]);
}

/**
 * Hands back the data already in state when the server returns exactly the
 * same thing, so a refresh every few seconds does not hand pages a brand new
 * array each time. Anything keyed on identity - the pager's current page, for
 * one - would otherwise jump back to the start under the user while they read.
 */
export const keepIfSame = (prev, next) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next);

/**
 * Flips to false when the component goes away. A loader checks it before
 * setState, so a reply that arrives after the user has left the page cannot
 * write into a component that is no longer there.
 */
export function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  return alive;
}
