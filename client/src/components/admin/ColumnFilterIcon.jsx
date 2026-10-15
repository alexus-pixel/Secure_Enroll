import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Wraps a filter control (a <select>, date inputs, whatever) behind
 * a small icon in a column header. The control itself is only ever
 * mounted in the DOM while `open` is true — it doesn't just hide
 * with CSS — so an unopened filter can't quietly keep a stale value
 * or fire a query nobody asked for.
 *
 * `active` lights the icon up (a filled dot) when this column
 * currently has a filter applied, so it's visible at a glance which
 * columns are filtered even after the popover is closed.
 */
export default function ColumnFilterIcon({ active, align = 'left', children }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function handleEscape(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <span className="col-filter" ref={wrapRef}>
      <button
        type="button"
        className={`col-filter-btn${active ? ' is-active' : ''}${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="Filter this column"
        aria-expanded={open}
      >
        <ChevronDown size={13} strokeWidth={2.5} />
      </button>
      {open && (
        <div className={`col-filter-popover align-${align}`} onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
    </span>
  );
}
