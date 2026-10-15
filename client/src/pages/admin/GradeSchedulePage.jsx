import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link, useOutletContext } from 'react-router-dom';
import {
  getSectionsForGrade, getSubjectsForGrade, getSectionSchedule,
  createSubject, deleteSubject, createScheduleEntry, deleteScheduleEntry,
  getTeachers, getGradeScheduleSummary, getSchoolSettings,
} from '../../api/admin';
import AddScheduleDrawer from './AddScheduleDrawer';

const DAYS = [1, 2, 3, 4, 5];
const DAY_LABELS = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };

export default function GradeSchedulePage() {
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
  const [newSubject, setNewSubject] = useState('');
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
    getSchoolSettings().then((data) => {
      const year = schoolYearId
        ? data.schoolYears.find((y) => y.id === schoolYearId)
        : data.schoolYears.find((y) => y.is_active);
      setIsReadOnly(year ? (year.is_ended || !year.is_active) : false);
      setYearLabel(year?.label || '');
    }).catch(() => {});

    getSectionsForGrade(gradeLevelId, schoolYearId).then((secs) => {
      setSections(secs);
      setActiveSectionId(secs[0]?.id || null);
    }).catch(() => {});
    getSubjectsForGrade(gradeLevelId, schoolYearId).then(setSubjects).catch(() => {});
    getTeachers().then(setTeachers).catch(() => {});
    getGradeScheduleSummary(schoolYearId).then((grades) => {
      const grade = grades.find((g) => String(g.id) === String(gradeLevelId));
      const name = grade ? `${grade.name} Schedule` : 'Class Schedule';
      setGradeName(grade?.name || '');
      setCrumb(name);
    }).catch(() => {});
    return () => setCrumb('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradeLevelId, schoolYearId]);

  function reloadEntries() {
    if (!activeSectionId) return;
    getSectionSchedule(activeSectionId, schoolYearId).then(setEntries).catch(() => {});
  }
  useEffect(reloadEntries, [activeSectionId, schoolYearId]);

  async function handleAddSubject(e) {
    e.preventDefault();
    if (!newSubject.trim()) return;
    try {
      const subject = await createSubject({ name: newSubject.trim(), gradeLevelId: Number(gradeLevelId), isDomain: false });
      setSubjects((s) => [...s, subject]);
      setNewSubject('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not add subject.');
    }
  }

  async function handleRemoveSubject(id) {
    try {
      await deleteSubject(id);
      setSubjects((s) => s.filter((x) => x.id !== id));
    } catch (err) {
      setError(err.response?.data?.message || 'Could not remove subject.');
    }
  }

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
    if (!newPeriodTimes.startTime || !newPeriodTimes.endTime || !activeSectionId) return;
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
      <Link to="/admin/schedules" className="back-link">&larr; Back to Class Schedules</Link>
      <div className="page-head">
        <div><h1>{gradeName ? `${gradeName} \u2014 Weekly Schedule` : 'Weekly Schedule'}</h1></div>
      </div>

      {isReadOnly && (
        <div className="alert" style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>
          {yearLabel} has ended \u2014 viewing this schedule as read-only.
        </div>
      )}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="btn-row" style={{ marginBottom: 16 }}>
        {sections.map((s) => (
          <button
            key={s.id}
            className={`btn btn-sm ${activeSectionId === s.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveSectionId(s.id)}
          >
            {s.name}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="admin-section-header" style={{ marginBottom: 10 }}>
          <strong>Subjects</strong>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {subjects.map((s) => (
            <span key={s.id} className="subject-tag">
              {s.name}
              {!isReadOnly && (
                <button onClick={() => handleRemoveSubject(s.id)} className="subject-tag-remove">
                  &times;
                </button>
              )}
            </span>
          ))}
        </div>
        {!isReadOnly && (
          <form onSubmit={handleAddSubject} className="admin-form" style={{ padding: 0, border: 'none' }}>
            <input className="input" placeholder="New subject name" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} />
            <button className="btn btn-secondary" type="submit">+ Add subject</button>
          </form>
        )}
      </div>

      {['morning', 'afternoon'].map((session) => {
        const periods = periodsForSession(session);
        return (
          <div key={session} className="card">
            <div className="admin-section-header" style={{ marginBottom: 10 }}>
              <h2 style={{ textTransform: 'capitalize', margin: 0 }}>{session} session</h2>
              {!isReadOnly && (
                addingPeriodFor === session ? (
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="time" className="input" style={{ width: 110 }}
                      value={newPeriodTimes.startTime} onChange={(e) => setNewPeriodTimes((t) => ({ ...t, startTime: e.target.value }))}
                    />
                    <span className="muted">to</span>
                    <input
                      type="time" className="input" style={{ width: 110 }}
                      value={newPeriodTimes.endTime} onChange={(e) => setNewPeriodTimes((t) => ({ ...t, endTime: e.target.value }))}
                    />
                    <button className="btn btn-secondary btn-sm" onClick={() => handleAddPeriod(session)} disabled={addingPeriod}>
                      {addingPeriod ? 'Adding...' : 'Add'}
                    </button>
                    <button className="link-action" onClick={() => { setAddingPeriodFor(null); setNewPeriodTimes({ startTime: '', endTime: '' }); }}>Cancel</button>
                  </span>
                ) : (
                  <button className="btn btn-secondary btn-sm" onClick={() => setAddingPeriodFor(session)}>+ Add Period</button>
                )
              )}
            </div>

            {periods.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>
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
                            className="link-action" style={{ fontSize: 10, display: 'block', marginTop: 2 }}
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
                                  className="link-action" style={{ fontSize: 10.5 }}
                                  onClick={(ev) => { ev.stopPropagation(); handleRemoveEntry(e.id); }}
                                >
                                  Remove
                                </button>
                              )}
                            </>
                          ) : (
                            !isReadOnly && <span className="muted" style={{ fontSize: 16 }}>+</span>
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