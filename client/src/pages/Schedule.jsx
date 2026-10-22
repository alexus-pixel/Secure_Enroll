import { useEffect, useState } from 'react';
import AppNav from '../components/AppNav';
import api from '../api/client';
import useEnrollment from '../hooks/useEnrollment';

const STATUS_LABELS = {
  draft: 'Draft', submitted: 'Submitted', under_review: 'Under Review', resubmitted: 'Resubmitted',
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


const DAYS = [1, 2, 3, 4, 5];
const DAY_LABELS = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };

// "13:00" -> "1:00 PM"
function clock(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// One child's published weekly timetable. The server decides whether it may be
// shown (approved, placed in a section, section published); this page only
// explains whichever answer comes back.
function Timetable({ applicationId, firstName }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.get(`/applications/${applicationId}/schedule`)
      .then(({ data: d }) => { if (live) setData(d); })
      .catch((err) => { if (live) setError(err.response?.data?.message || 'Could not load the schedule.'); });
    return () => { live = false; };
  }, [applicationId]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return <div className="empty-state">Loading&hellip;</div>;
  if (data.state === 'no_section') {
    return <div className="empty-state">{firstName} has not been placed in a section yet. The schedule will appear once the school does.</div>;
  }
  if (data.state === 'not_published') {
    return (
      <div className="empty-state">
        {firstName}&rsquo;s class schedule has not been published yet. Please check back later &mdash;
        the school posts it once the timetable for {data.gradeLevel} &middot; {data.section} is final.
      </div>
    );
  }
  if (data.state !== 'published') {
    return <div className="empty-state"><LockIcon /> {firstName}&rsquo;s schedule unlocks once their enrollment is approved.</div>;
  }

  const sessions = ['morning', 'afternoon']
    .map((session) => {
      const rows = data.entries.filter((e) => e.session === session);
      const periods = [...new Map(rows.map((e) => [`${e.startTime}-${e.endTime}`, { startTime: e.startTime, endTime: e.endTime }])).values()]
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      return { session, rows, periods };
    })
    .filter((s) => s.periods.length > 0);

  return (
    <div>
      <div className="tt-head">
        <div>
          <b>{data.firstName} {data.lastName}</b>
          <div className="muted">
            {data.gradeLevel} &middot; {data.section} &middot; S.Y. {data.schoolYear}
            {data.adviser ? <> &middot; Adviser: {data.adviser}</> : null}
          </div>
        </div>
        <button type="button" className="btn btn-secondary btn-sm no-print" onClick={() => window.print()}>Print</button>
      </div>

      {sessions.length === 0 && <div className="empty-state">No periods are listed yet.</div>}
      {sessions.map(({ session, rows, periods }) => (
        <div key={session} className="tt-session">
          <h3 style={{ textTransform: 'capitalize' }}>{session} session</h3>
          <div className="tt-scroll">
            <div className="tt-grid">
              <div className="tt-cell tt-headcell" />
              {DAYS.map((d) => <div key={d} className="tt-cell tt-headcell">{DAY_LABELS[d]}</div>)}
              {periods.map((p) => (
                <div key={`${p.startTime}-${p.endTime}`} style={{ display: 'contents' }}>
                  <div className="tt-cell tt-time">{clock(p.startTime)}<br />{clock(p.endTime)}</div>
                  {DAYS.map((d) => {
                    const e = rows.find((r) => r.startTime === p.startTime && r.endTime === p.endTime && r.days.includes(d));
                    return (
                      <div key={d} className="tt-cell">
                        {e && (
                          <>
                            <div className="tt-subject">{e.subject}</div>
                            <div className="tt-sub">{e.teacher}</div>
                            {e.room && <div className="tt-sub">{e.room}</div>}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Schedule() {
  const { year } = useEnrollment();
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    api.get('/applications/mine').then(({ data }) => {
      // Only the newest school year has a timetable to show; earlier years'
      // applications are history and would just read "not placed in a section".
      const newest = data.reduce((m, a) => (a.school_year > m ? a.school_year : m), '');
      const current = data.filter((a) => a.school_year === newest);
      setApplications(current);
      if (current.length > 0) setSelectedId(current[0].id);
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
            <p>{year ? `School Year ${year} \u00b7 ` : ''}available once an enrollment is approved</p>
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
                  <Timetable key={selected.id} applicationId={selected.id} firstName={selected.first_name} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
