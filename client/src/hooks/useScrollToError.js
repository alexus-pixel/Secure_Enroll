import { useEffect } from 'react';

// Every error banner in this app (.alert.alert-error) sits near the top
// of its page or form, right below the heading. That's useless if the
// person is scrolled down a long form when they hit Submit -- they see
// nothing happen and have no idea why. This scrolls back to the top the
// moment an error appears, so the message is actually visible without
// them having to go looking for it.
export function useScrollToError(error) {
  useEffect(() => {
    if (error) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [error]);
}
