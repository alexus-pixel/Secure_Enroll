import { useEffect, useState } from 'react';
import AppNav from '../components/AppNav';
import api from '../api/client';

const STATUS_LABELS = {
  draft: 'Draft', submitted: 'Submitted', under_review: 'Under Review',
  needs_revision: 'Needs Revision', approved: 'Approved', rejected: 'Rejected',
};

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export default function Schedule() {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    api.get('/applications/mine').then(({ data }) => {
      setApplications(data);
      if (data.length > 0) setSelectedId(data[0].id);
    }).finally(() => setLoading(false));
  }, []);

  const selected = applications.find((a) => a.id === selectedId);

  return (
    <>
      <AppNav crumbs={[{ label: 'Schedule' }]} />
      <div className="container">
        <div className="page-head">
          <div>
            <h1>My Children&rsquo;s Schedule</h1>
            <p>School Year 2026&ndash;2027 &middot; available once an enrollment is approved</p>
          </div>
        </div>

        <div className="card card-flush">
          {loading ? (
            <div className="empty-state">Loading&hellip;</div>
          ) : applications.length === 0 ? (
            <div className="empty-state">
              No children enrolled yet. Once an application is approved, their class schedule will appear here.
            </div>
          ) : (
            <>
              <div className="schedule-tabs">
                {applications.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`schedule-tab${a.id === selectedId ? ' active' : ''}`}
                    onClick={() => setSelectedId(a.id)}
                  >
                    <span className="schedule-tab-name">{a.last_name}, {a.first_name}</span>
                    <span className="schedule-tab-sub">
                      {a.grade_level}
                      {a.status === 'approved' && a.section ? ` \u2013 ${a.section}` : ` \u2013 ${STATUS_LABELS[a.status] || a.status}`}
                    </span>
                    {a.status !== 'approved' && (
                      <span className="schedule-tab-lock"><LockIcon /> Available once approved</span>
                    )}
                  </button>
                ))}
              </div>

              <div style={{ padding: 24 }}>
                {selected && selected.status !== 'approved' && (
                  <div className="empty-state">
                    <LockIcon /> {selected.first_name}&rsquo;s schedule will unlock once their enrollment is approved.
                    Current status: <b>{STATUS_LABELS[selected.status] || selected.status}</b>.
                  </div>
                )}
                {selected && selected.status === 'approved' && (
                  <div className="empty-state">
                    {selected.first_name}&rsquo;s class schedule will appear here once it&rsquo;s been published.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
