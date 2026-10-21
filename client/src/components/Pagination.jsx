/* eslint-disable react-refresh/only-export-components -- the hook and the
   component belong together; pages import both from here. */
import { useCallback, useMemo, useState } from 'react';
import './pagination.css';

export const PAGE_SIZE = 10;

/**
 * Slices a list of rows into pages of `pageSize`.
 *
 * Pagination is applied *after* a page's own filtering/sorting: pass the
 * already-filtered array in. When that array changes identity (a filter was
 * changed, data reloaded) we go back to page 1; when it merely shrinks past
 * the current page we fall back to the last page that still exists, so the
 * table never renders empty while rows are available.
 */
export function usePagination(rows, pageSize = PAGE_SIZE) {
  const list = useMemo(() => (Array.isArray(rows) ? rows : []), [rows]);
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // The chosen page is remembered together with the row set it was chosen
  // for, so a new row set (filter changed, data reloaded) starts at page 1
  // without needing an effect to reset it.
  const [chosen, setChosen] = useState({ rows, page: 1 });
  const setPage = useCallback((next) => setChosen({ rows, page: next }), [rows]);
  const page = chosen.rows === rows ? chosen.page : 1;

  // Clamp: the remembered page may no longer exist after rows shrink.
  const safePage = Math.min(Math.max(1, page), totalPages);

  const pageRows = useMemo(
    () => list.slice((safePage - 1) * pageSize, (safePage - 1) * pageSize + pageSize),
    [list, safePage, pageSize],
  );

  return {
    page: safePage,
    setPage,
    pageRows,
    totalPages,
    total,
    from: total === 0 ? 0 : (safePage - 1) * pageSize + 1,
    to: total === 0 ? 0 : Math.min(total, safePage * pageSize),
  };
}

// First, last, current and its neighbours -- never more than 7 numbers,
// with an ellipsis standing in for the pages that are skipped.
function pageItems(page, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const items = [1];
  let start = Math.max(2, page - 1);
  let end = Math.min(totalPages - 1, page + 1);
  if (page <= 3) { start = 2; end = 4; }
  if (page >= totalPages - 2) { start = totalPages - 3; end = totalPages - 1; }
  if (start > 2) items.push('start-gap');
  for (let i = start; i <= end; i += 1) items.push(i);
  if (end < totalPages - 1) items.push('end-gap');
  items.push(totalPages);
  return items;
}

export default function Pagination({
  page, totalPages, total, from, to, onPage, label = 'rows',
}) {
  if (!total) return null;

  return (
    <div className="pager">
      <p className="pager-count">
        Showing {from}&ndash;{to} of {total} {label}
      </p>
      {totalPages > 1 && (
        <nav className="pager-nav" aria-label="Pagination">
          <button
            type="button" className="pager-btn" aria-label="Previous page"
            disabled={page <= 1} onClick={() => onPage(page - 1)}
          >
            Previous
          </button>
          <span className="pager-pages">
            {pageItems(page, totalPages).map((item) => (
              typeof item === 'number' ? (
                <button
                  key={item} type="button"
                  className={`pager-btn pager-num${item === page ? ' is-current' : ''}`}
                  aria-current={item === page ? 'page' : undefined}
                  aria-label={`Page ${item}`}
                  onClick={() => onPage(item)}
                >
                  {item}
                </button>
              ) : (
                <span key={item} className="pager-gap" aria-hidden="true">&hellip;</span>
              )
            ))}
          </span>
          <button
            type="button" className="pager-btn" aria-label="Next page"
            disabled={page >= totalPages} onClick={() => onPage(page + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
