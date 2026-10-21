import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link, useLocation, useOutletContext } from 'react-router-dom';
import {
  getSectionsForGrade, getSectionSchedule,
  createScheduleEntry, deleteScheduleEntry,
  getScheduleTeachers, getGradeScheduleSummary, getScheduleSchoolYears,
} from '../../api/admin';
import AddScheduleDrawer, { sessionTimeIssue, DAY_OPENS, DAY_CLOSES } from './AddScheduleDrawer';
import SubjectsPanel from './SubjectsPanel';

const DAYS = [1, 2, 3, 4, 5];
const DAY_LABELS = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };

// A <input type="time"> box has to hold a whole 12-hour reading — "09:00 AM" —
// next to the clock button Chrome draws inside it. At 110px it cut off at
// "09:00 A", so the admin could not read back the time they had just typed.
// .input's side padding and border take about 24px of the box, leaving
// around 126px for the reading and the button at 14.5px type — comfortably
// more than they need, deliberately, since the exact width depends on the
// font the browser happens to use.
const TIME_BOX_WIDTH = 150;

export default function GradeSchedulePage() {
  // The registrar portal shows this same page, so links stay inside it.
  const portal = useLocation().pathname.startsWith('/registrar') ? '/registrar' : '/admin';
  const { gradeLevelId } = useParams();
  const [searchParams] = useSearchParams();
  const schoolYearId = searchParams.get('schoolYearId') ? Number(searchParams.get('schoolYearId')) : undefined;
  const { setCrumb } = useOutletContext();
  const [gradeName, setGradeName] = useState('');
  const [sections, setSections] = useState([]);
  const [activeSectionId, setActiveSectionId] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [drawer, setDrawer] = useState(null); // null | { entry?, initialSession?, initialStartTime?, initialEndTime? }
  const [error, setError] = useState('');
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [yearLabel, setYearLabel] = useState('');
  const [addingPeriodFor, setAddingPeriodFor] = useState(null); // 'morning' | 'afternoon' | null
  const [newPeriodTimes, setNewPeriodTimes] = useState({ startTime: '', endTime: '' });
  const [addingPeriod, setAddingPeriod] = useState(false);

  useEffect(() => {
    // Whether THIS specific year (not necessarily the active one —
    // the admin may be viewing a previous year via the Class
    // Schedules filter) is still open for editing.
    getScheduleSchoolYears().then((schoolYears) => {
      const year = schoolYearId
        ? schoolYears.find((y) => y.id === schoolYearId)
        : schoolYears.find((y) => y.is_active);
      setIsReadOnly(year ? (year.is_ended || !year.is_active) : false);
      setYearLabel(year?.label || '');
    }).catch(() => {});

    getSectionsForGrade(gradeLevelId, schoolYearId).then((secs) => {
      setSections(secs);
      setActiveSectionId(secs[0]?.id || null);
    }).catch(() => {});
    getScheduleTeachers().then(setTeachers).catch(() => {});
    getGradeScheduleSummary(schoolYearId).then((grades) => {
      const grade = grades.find((g) => String(g.id) === String(gradeLevelId));
      const name = grade ? `${grade.name} Schedule` : 'Class Schedule';
      setGradeName(grade?.name || '');
      setCrumb(name);
    }).catch(() => {});
    return () => setCrumb('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradeLevelId, schoolYearId]);

  // The section whose timetable is on screen, and who advises it.
  // sections.adviser_teacher_id is set from School Settings and comes
  // down with the section list (/admin/schedules/grades/:id/sections),
  // which the registrar can read as well.
  const activeSection = sections.find((s) => s.id === activeSectionId) || null;
  // Whatever stands in the way of adding the period typed into the
  // "+ Add Period" row for this session, or null while nothing does.
  //
  // "No time yet" is one of the answers here, not something the save
  // handler quietly discovers on its own. A part-filled time box hands
  // back an empty string — the hour can be sitting in the field while
  // the AM/PM half is still blank — so the row has to say so, instead
  // of leaving an Add button that looks ready and does nothing.
  const newPeriodIssue = (session) => {
    if (!activeSectionId) return 'This grade level has no sections yet \u2014 add one in School Settings first.';
    if (!newPeriodTimes.startTime || !newPeriodTimes.endTime) return 'Enter a start and an end time (including AM/PM).';
    return sessionTimeIssue(session, newPeriodTimes.startTime, newPeriodTimes.endTime);
  };
  const adviserOf = (section) => section?.adviser_name || null;

  function reloadEntries() {
    if (!activeSectionId) return;
    getSectionSchedule(activeSectionId, schoolYearId).then(setEntries).catch(() => {});
  }
  useEffect(reloadEntries, [activeSectionId, schoolYearId]);

  async function handleRemoveEntry(id) {
    try {
      await deleteScheduleEntry(id);
      reloadEntries();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not remove that period.');
    }
  }

  // Every row shown is a real, already-persisted entry — including
  // a still-blank one ("+ Add Period" with nothing assigned into it
  // yet), since that's created on the server immediately rather
  // than held only in local state. That's what makes a period
  // survive navigating away before anything gets scheduled into it.
  function periodsForSession(session) {
    const merged = new Map();
    for (const e of entries) {
      if (e.session !== session) continue;
      const startTime = e.start_time?.slice(0, 5);
      const endTime = e.end_time?.slice(0, 5);
      const key = `${startTime}-${endTime}`;
      if (!merged.has(key)) merged.set(key, { startTime, endTime, blankEntryId: null });
      // A row is only removable while every entry sharing its time
      // is still unassigned — recorded per row so Remove can target
      // the right (only) blank row directly.
      if (!e.subject_id && !e.teacher_id) merged.get(key).blankEntryId = e.id;
    }
    return [...merged.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  function cellEntry(session, day, startTime) {
    return entries.find((e) => e.session === session && (e.days || []).includes(day) && e.start_time?.slice(0, 5) === startTime);
  }

  async function handleAddPeriod(session) {
    // Every reason not to send this is said out loud, including a
    // still-blank time: returning here without a word is what made
    // the Add button look broken.
    //
    // A period also has to sit inside the half of the day its session
    // names — 9 PM to 10 PM is not a morning period. The server
    // refuses it either way; this just says so without a round trip.
    const issue = newPeriodIssue(session);
    if (issue) {
      setError(issue);
      return;
    }
    setAddingPeriod(true);
    setError('');
    try {
      await createScheduleEntry({
        sectionId: activeSectionId, subjectId: null, teacherId: null, roleType: 'subject',
        session, days: [], startTime: newPeriodTimes.startTime, endTime: newPeriodTimes.endTime, room: null,
      });
      setAddingPeriodFor(null);
      setNewPeriodTimes({ startTime: '', endTime: '' });
      reloadEntries();
    } catch (err) {
      const data = err.response?.data;
      setError(data?.errors?.map((x) => x.message).join(' ') || data?.message || 'Could not add that period.');
    } finally {
      setAddingPeriod(false);
    }
  }

  return (
    <div>
      <Link to={`${portal}/schedules`} className="back-link">&larr; Back to Class Schedules</Link>
      <div className="page-head">
        <div>
          <h1>{gradeName ? `${gradeName} \u2014 Weekly Schedule` : 'Weekly Schedule'}</h1>
          {activeSection && (
            <p className="muted" style={{ margin: '2px 0 0' }}>
              {activeSection.name} &middot;{' '}
              <span>
                Adviser:{' '}
                {adviserOf(activeSection)
                  ? <b>{adviserOf(activeSection)}</b>
                  : <span className="muted">No adviser assigned yet</span>}
              </span>
            </p>
          )}
        </div>
      </div>

      {isReadOnly && (
        <div className="alert" style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>
          {yearLabel} has ended &mdash; viewing this schedule as read-only.
        </div>
      )}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="btn-row" style={{ marginBottom: 16 }}>
        {sections.map((s) => (
          <button
            key={s.id}
            className={`btn btn-sm ${activeSectionId === s.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveSectionId(s.id)}
            title={adviserOf(s) ? `Adviser: ${adviserOf(s)}` : 'No adviser assigned yet'}
          >
            {s.name}
            <span style={{ opacity: 0.75, fontWeight: 400 }}>
              {' \u00b7 '}{adviserOf(s) || 'no adviser'}
            </span>
          </button>
        ))}
      </div>

      {/* Add / rename / remove this grade's subjects, and adjust how
          many it may have at all. It keeps `subjects` here in step, so
          the Add Period drawer always offers the current list. */}
      <SubjectsPanel
        gradeLevelId={gradeLevelId}
        schoolYearId={schoolYearId}
        isReadOnly={isReadOnly}
        onSubjectsChange={setSubjects}
      />

      {['morning', 'afternoon'].map((session) => {
        const periods = periodsForSession(session);
        // Why "Add" is greyed out, when it is — shown beside the button
        // and not only in its tooltip, so the reason is on screen.
        const addIssue = newPeriodIssue(session);
        const timesTyped = !!(newPeriodTimes.startTime && newPeriodTimes.endTime);
        return (
          <div key={session} className="card">
            <div className="admin-section-header" style={{ marginBottom: 10 }}>
              <h2 style={{ textTransform: 'capitalize', margin: 0 }}>{session} session</h2>
              {!isReadOnly && (
                addingPeriodFor === session ? (
                  /* Wider time boxes make this row too long for a narrow
                     window, and .admin-section-header does not wrap on its
                     own — so the row wraps here instead of pushing the Add
                     and Cancel buttons off the edge of the card. */
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <input
                      type="time" className="input" style={{ width: TIME_BOX_WIDTH }} min={DAY_OPENS} max={DAY_CLOSES}
                      aria-label={`Start time of the new ${session} period`}
                      value={newPeriodTimes.startTime} onChange={(e) => setNewPeriodTimes((t) => ({ ...t, startTime: e.target.value }))}
                    />
                    <span className="muted">to</span>
                    <input
                      type="time" className="input" style={{ width: TIME_BOX_WIDTH }} min={DAY_OPENS} max={DAY_CLOSES}
                      aria-label={`End time of the new ${session} period`}
                      value={newPeriodTimes.endTime} onChange={(e) => setNewPeriodTimes((t) => ({ ...t, endTime: e.target.value }))}
                    />
                    <button
                      className="btn btn-secondary btn-sm" onClick={() => handleAddPeriod(session)}
                      disabled={addingPeriod || !!addIssue}
                      title={addIssue || undefined}
                    >
                      {addingPeriod ? 'Adding...' : 'Add'}
                    </button>
                    <button className="link-action" onClick={() => { setAddingPeriodFor(null); setNewPeriodTimes({ startTime: '', endTime: '' }); }}>Cancel</button>
                    {addIssue && (
                      <span className={timesTyped ? 'field-error' : 'hint'} style={{ margin: 0 }}>{addIssue}</span>
                    )}
                  </span>
                ) : (
                  /* The row opens blank. The two sessions share one pair
                     of time boxes, so times left behind by the other
                     session's row would otherwise arrive already breaking
                     this session's half of the day — Add greyed out the
                     moment the row appeared, for no visible reason. */
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setAddingPeriodFor(session);
                      setNewPeriodTimes({ startTime: '', endTime: '' });
                      setError('');
                    }}
                  >
                    + Add Period
                  </button>
                )
              )}
            </div>

            {periods.length === 0 ? (
              <p className="muted" style={{ fontSize: 14.5 }}>
                No periods yet for this session{!isReadOnly && ' \u2014 use "+ Add Period" to create the first one'}.
              </p>
            ) : (
              <div className="week-grid">
                <div className="week-grid-head"></div>
                {DAYS.map((d) => <div key={d} className="week-grid-head">{DAY_LABELS[d]}</div>)}
                {periods.map((p) => (
                  <div key={`${p.startTime}-${p.endTime}`} style={{ display: 'contents' }}>
                    <div className="week-time-cell">
                      <div>
                        {p.startTime}&ndash;{p.endTime}
                        {!isReadOnly && p.blankEntryId && (
                          <button
                            className="link-action" style={{ fontSize: 11.5, display: 'block', marginTop: 2 }}
                            onClick={() => handleRemoveEntry(p.blankEntryId)}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                    {DAYS.map((d) => {
                      const e = cellEntry(session, d, p.startTime);
                      return (
                        <div
                          key={d}
                          className="week-cell"
                          onClick={() => {
                            if (isReadOnly) return;
                            e ? setDrawer({ entry: e }) : setDrawer({ initialSession: session, initialStartTime: p.startTime, initialEndTime: p.endTime });
                          }}
                          style={isReadOnly ? { cursor: 'default' } : undefined}
                        >
                          {e ? (
                            <>
                              <div className="week-cell-subject">{e.subject_name}</div>
                              <div className="week-cell-teacher">{e.teacher_last_name}, {e.teacher_first_name?.[0]}.</div>
                              {!isReadOnly && (
                                <button
                                  className="link-action" style={{ fontSize: 12 }}
                                  onClick={(ev) => { ev.stopPropagation(); handleRemoveEntry(e.id); }}
                                >
                                  Remove
                                </button>
                              )}
                            </>
                          ) : (
                            !isReadOnly && <span className="muted" style={{ fontSize: 18 }}>+</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {drawer && activeSectionId && !isReadOnly && (
        <AddScheduleDrawer
          sectionId={activeSectionId}
          gradeLevelId={gradeLevelId}
          schoolYearId={schoolYearId}
          sectionName={activeSection?.name}
          adviserName={adviserOf(activeSection)}
          subjects={subjects}
          teachers={teachers}
          entry={drawer.entry}
          initialSession={drawer.initialSession}
          initialStartTime={drawer.initialStartTime}
          initialEndTime={drawer.initialEndTime}
          onClose={() => setDrawer(null)}
          onSaved={(result) => {
            if (result?.conflict || result?.dailyCapExceeded || result?.overLoad || result?.duplicateSubject) return; // AddScheduleDrawer already shows this; entry not created
            setDrawer(null);
            reloadEntries();
          }}
        />
      )}
    </div>
  );
}