import { useEffect, useState } from 'react';
import { getSectionStudents } from '../../api/admin';
import Pagination, { usePagination } from '../../components/Pagination';

// The date the enrollment was approved, written the way the rest of the
// admin area writes dates. A missing date is never printed as "Invalid
// Date".
function approvedOn(value) {
  if (!value) return '\u2014';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '\u2014';
  return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * "Who is actually in this section?" — the learners whose enrollment was
 * approved into it, by name, ten to a page.
 *
 * Name, sex and the date approved only: the LRN, birth date, contact
 * number and address are encrypted personal data and a seating list has
 * no need of them, so the endpoint behind this never returns them.
 */
export default function SectionStudentsModal({ section, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const pager = usePagination(data?.students || []);

  useEffect(() => {
    let live = true;
    getSectionStudents(section.id)
      .then((result) => { if (live) setData(result); })
      .catch((err) => {
        if (live) setError(err.response?.data?.message || 'Could not load the learners in this section.');
      });
    return () => { live = false; };
  }, [section.id]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 style={{ marginBottom: 2 }}>Learners in {section.name}</h2>
          <button className="btn-ghost" onClick={onClose} type="button">Close</button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <p className="muted" style={{ marginTop: 0 }}>
          {data
            ? `${data.count} enrolled learner${data.count === 1 ? '' : 's'}`
              + `${data.section.gradeLevelName ? ` \u2014 ${data.section.gradeLevelName}` : ''}`
              + `${data.section.capacity ? ` (${data.count}/${data.section.capacity} seats)` : ''}`
            : 'Loading\u2026'}
        </p>

        {data && data.count === 0 && (
          <p className="muted" style={{ padding: '18px 0', textAlign: 'center' }}>
            No learner has been enrolled in this section yet. Learners appear here once their
            application is approved into it.
          </p>
        )}

        {data && data.count > 0 && (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Learner</th><th>Sex</th><th>Date approved</th></tr>
                </thead>
                <tbody>
                  {pager.pageRows.map((s) => (
                    <tr key={s.applicationId}>
                      <td>{s.name}</td>
                      <td>{s.sex}</td>
                      <td>{approvedOn(s.approvedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={pager.page} totalPages={pager.totalPages} total={pager.total}
              from={pager.from} to={pager.to} onPage={pager.setPage} label="learners"
            />
          </>
        )}
      </div>
    </div>
  );
}
