import { useEffect, useState } from 'react';
import { useParams, Link, useOutletContext } from 'react-router-dom';
import {
  getSectionsForGrade, getSubjectsForGrade, getSectionSchedule,
  createSubject, deleteSubject, deleteScheduleEntry, getTeachers, getGradeScheduleSummary,
} from '../../api/admin';
import AddScheduleDrawer from './AddScheduleDrawer';

const DAYS = [1, 2, 3, 4, 5];
const DAY_LABELS = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };

export default function GradeSchedulePage() {
  const { gradeLevelId } = useParams();
  const { setCrumb } = useOutletContext();
  const [gradeName, setGradeName] = useState('');
  const [sections, setSections] = useState([]);
  const [activeSectionId, setActiveSectionId] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [newSubject, setNewSubject] = useState('');
  const [drawer, setDrawer] = useState(null); // null | { entry?: ... }
  const [error, setError] = useState('');

  useEffect(() => {
    getSectionsForGrade(gradeLevelId).then((secs) => {
      setSections(secs);
      setActiveSectionId(secs[0]?.id || null);
    }).catch(() => {});
    getSubjectsForGrade(gradeLevelId).then(setSubjects).catch(() => {});
    getTeachers().then(setTeachers).catch(() => {});
    getGradeScheduleSummary().then((grades) => {
      const grade = grades.find((g) => String(g.id) === String(gradeLevelId));
      const name = grade ? `${grade.name} Schedule` : 'Class Schedule';
      setGradeName(grade?.name || '');
      setCrumb(name);
    }).catch(() => {});
    return () => setCrumb('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradeLevelId]);

  function reloadEntries() {
    if (!activeSectionId) return;
    getSectionSchedule(activeSectionId).then(setEntries).catch(() => {});
  }
  useEffect(reloadEntries, [activeSectionId]);

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
    await deleteScheduleEntry(id);
    reloadEntries();
  }

  function cellEntry(session, day) {
    return entries.find((e) => e.session === session && (e.days || []).includes(day));
  }

  return (
    <div>
      <Link to="/admin/schedules" className="back-link">&larr; Back to Class Schedules</Link>
      <div className="page-head">
        <div><h1>{gradeName ? `${gradeName} \u2014 Weekly Schedule` : 'Weekly Schedule'}</h1></div>
      </div>

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
              <button onClick={() => handleRemoveSubject(s.id)} className="subject-tag-remove">
                &times;
              </button>
            </span>
          ))}
        </div>
        <form onSubmit={handleAddSubject} className="admin-form" style={{ padding: 0, border: 'none' }}>
          <input className="input" placeholder="New subject name" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} />
          <button className="btn btn-secondary" type="submit">+ Add subject</button>
        </form>
      </div>

      {['morning', 'afternoon'].map((session) => (
        <div key={session} className="card">
          <h2 style={{ textTransform: 'capitalize' }}>{session} session</h2>
          <div className="week-grid">
            <div className="week-grid-head"></div>
            {DAYS.map((d) => <div key={d} className="week-grid-head">{DAY_LABELS[d]}</div>)}
            <div className="week-time-cell">Periods</div>
            {DAYS.map((d) => {
              const e = cellEntry(session, d);
              return (
                <div
                  key={d}
                  className="week-cell"
                  onClick={() => (e ? setDrawer({ entry: e }) : setDrawer({}))}
                >
                  {e ? (
                    <>
                      <div className="week-cell-subject">{e.subject_name}</div>
                      <div className="week-cell-teacher">{e.teacher_last_name}, {e.teacher_first_name?.[0]}.</div>
                      <button
                        className="link-action" style={{ fontSize: 10.5 }}
                        onClick={(ev) => { ev.stopPropagation(); handleRemoveEntry(e.id); }}
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="muted" style={{ fontSize: 16 }}>+</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {drawer && activeSectionId && (
        <AddScheduleDrawer
          sectionId={activeSectionId}
          subjects={subjects}
          teachers={teachers}
          entry={drawer.entry}
          onClose={() => setDrawer(null)}
          onSaved={(result) => {
            if (result?.conflict) return; // AddScheduleDrawer already shows this; entry not created
            setDrawer(null);
            reloadEntries();
          }}
        />
      )}
    </div>
  );
}
