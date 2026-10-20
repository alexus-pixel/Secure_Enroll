import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { getTeachers, getTeacher, createTeacher, updateTeacher } from '../../api/admin';
import {
  setTeacherActive, getPendingTransfer, getTeacherHandover, handOverTeacher,
} from '../../api/teachers';
import TeacherFormModal from './TeacherFormModal';

const NO_EMAIL = 'No email address on file';

/**
 * The step behind the Activate / Deactivate button.
 *
 * A teacher does not simply stop teaching: the sections they advise and the
 * subjects they teach have to go to somebody first, and each one separately,
 * so a whole timetable is not dropped on one colleague. This asks who takes
 * what, offering only teachers who already teach that subject, are free at
 * that hour, and stay inside their own daily period limit — anyone who cannot
 * is shown with the reason rather than quietly left out.
 *
 * Reactivating asks "are you sure", and offers to move back the periods that
 * were handed over, where they are still exactly as they were.
 */
function TeacherStatusDialog({ teacher, onClose, onDone }) {
  const deactivating = teacher.is_active;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // What has to be handed over, and who could take it. undefined while it is
  // still being looked up.
  const [work, setWork] = useState(deactivating ? undefined : null);
  // subjectId -> receiving teacher id, sectionId -> new adviser id
  const [subjectPick, setSubjectPick] = useState({});
  const [adviserPick, setAdviserPick] = useState({});
  // undefined while it is still being looked up, null when there is
  // nothing waiting to be given back.
  const [pending, setPending] = useState(teacher.is_active ? null : undefined);
  const [restoreWanted, setRestoreWanted] = useState(true);

  const name = `${teacher.first_name} ${teacher.last_name}`;

  // Deactivating: what would be left behind, and who may take it on.
  useEffect(() => {
    if (!deactivating) return undefined;
    let live = true;
    getTeacherHandover(teacher.id)
      .then((data) => { if (live) setWork(data); })
      .catch((err) => {
        if (!live) return;
        setWork({ subjects: [], advisories: [], nothingToHandOver: true, blocked: [] });
        setError(err.response?.data?.message || 'Could not work out what this teacher would hand over.');
      });
    return () => { live = false; };
  }, [deactivating, teacher.id]);

  // Only when activating: was anything handed over when this teacher
  // was deactivated, and is it still waiting to come back?
  useEffect(() => {
    if (deactivating) return undefined; // nothing to give back when switching off
    let live = true;
    getPendingTransfer(teacher.id)
      .then((data) => { if (live) setPending(data.pending ? data.transfer : null); })
      .catch(() => { if (live) setPending(null); });
    return () => { live = false; };
  }, [deactivating, teacher.id]);

  const subjects = work?.subjects || [];
  const advisories = work?.advisories || [];
  const everythingChosen = subjects.every((s) => subjectPick[s.subjectId])
    && advisories.every((a) => adviserPick[a.sectionId]);
  const stuck = work?.blocked || [];

  async function activate() {
    setBusy(true);
    setError('');
    try {
      const restore = Boolean(pending && restoreWanted);
      const result = await setTeacherActive(teacher.id, true, restore);
      const base = `${name} is active again.`;
      onDone(result.restore?.message ? `${base} ${result.restore.message}` : base);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not change this teacher’s status.');
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    setBusy(true);
    setError('');
    try {
      const result = await handOverTeacher(teacher.id, {
        subjects: subjects.map((s) => ({ subjectId: s.subjectId, teacherId: Number(subjectPick[s.subjectId]) })),
        advisers: advisories.map((a) => ({ sectionId: a.sectionId, teacherId: Number(adviserPick[a.sectionId]) })),
      });
      onDone(result.message);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not hand this teacher’s classes over.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel is-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{deactivating ? 'Deactivate teacher' : 'Activate teacher'}</h2>
          <button className="btn-ghost" onClick={onClose} type="button">Close</button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {!deactivating && (
          <>
            <p>Activate {name}? They can be given classes again.</p>
            {pending && (
              <div className="card" style={{ marginTop: 12, padding: 12 }}>
                <p style={{ margin: '0 0 6px' }}>
                  When {name} was deactivated, {pending.count} class
                  assignment{pending.count === 1 ? '' : 's'} {pending.count === 1 ? 'was' : 'were'} handed
                  to <b>{pending.toTeacherName}</b>:
                </p>
                <ul style={{ margin: '0 0 10px 18px', padding: 0, fontSize: 14 }}>
                  {pending.entries.map((e) => <li key={e.id}>{e.label}</li>)}
                </ul>
                <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, margin: 0 }}>
                  <input
                    type="checkbox" checked={restoreWanted}
                    onChange={(e) => setRestoreWanted(e.target.checked)}
                  />
                  <span>Move {pending.count === 1 ? 'it' : 'them'} back to {name}</span>
                </label>
                <p className="hint" style={{ margin: '6px 0 0' }}>
                  Only the periods still exactly as they were handed over come back. One that has since been
                  changed, removed or moved on again is left alone, and one that would double-book {name} is
                  refused — either way the reply says which. An advisory class is never taken back
                  automatically, because somebody has been advising it since.
                </p>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn btn-secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" type="button" onClick={activate} disabled={busy || pending === undefined}>
                {busy ? 'Working...' : pending && restoreWanted ? 'Activate and move the schedule back' : 'Yes, activate'}
              </button>
            </div>
          </>
        )}

        {deactivating && work === undefined && <p className="muted">Checking what {name} would hand over…</p>}

        {deactivating && work && work.nothingToHandOver && (
          <>
            <p>
              Deactivate {name}? They hold no classes and advise no section this school year, so nothing
              has to be handed over. They will stop appearing as an available teacher.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn btn-secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" type="button" onClick={deactivate} disabled={busy}>
                {busy ? 'Working...' : 'Yes, deactivate'}
              </button>
            </div>
          </>
        )}

        {deactivating && work && !work.nothingToHandOver && (
          <>
            <p>
              {name} cannot simply stop teaching: every class they hold has to have somebody else’s name
              against it first. Choose who takes each one.
            </p>
            {stuck.length > 0 && (
              <div className="alert alert-error">
                <b>Nobody can take {stuck.join(', ')}.</b>
                <div style={{ marginTop: 4 }}>
                  A subject can only go to a teacher who teaches it and has room on those days. Add the
                  subject to another teacher’s list on their Edit screen, or give the periods to somebody
                  else in Class Schedules, then come back.
                </div>
              </div>
            )}

            {advisories.length > 0 && (
              <div className="handover-group">
                <h3>Advisory class{advisories.length === 1 ? '' : 'es'}</h3>
                {advisories.map((a) => (
                  <div key={a.sectionId} className="handover-row">
                    <div>
                      <b>{a.gradeLevelName} — {a.sectionName}</b>
                      <div className="cell-sub">A teacher advises one section only.</div>
                    </div>
                    <select
                      className="input" value={adviserPick[a.sectionId] || ''}
                      aria-label={`New adviser for ${a.sectionName}`}
                      onChange={(e) => setAdviserPick({ ...adviserPick, [a.sectionId]: e.target.value })}
                    >
                      <option value="">Choose the new adviser</option>
                      {a.candidates.map((c) => (
                        <option key={c.id} value={c.id} disabled={!c.eligible}>
                          {c.name}{c.eligible ? '' : ` — ${c.reason}`}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            {subjects.length > 0 && (
              <div className="handover-group">
                <h3>Subject{subjects.length === 1 ? '' : 's'} taught</h3>
                {subjects.map((s) => (
                  <div key={s.subjectId ?? 'none'} className="handover-row">
                    <div>
                      <b>{s.subjectName}</b> <span className="muted">({s.gradeLevelName})</span>
                      <div className="cell-sub">
                        {s.periods.length} period{s.periods.length === 1 ? '' : 's'}: {s.periods.map((p) => p.label).join('; ')}
                      </div>
                    </div>
                    <select
                      className="input" value={subjectPick[s.subjectId] || ''}
                      aria-label={`Who takes over ${s.subjectName}`}
                      onChange={(e) => setSubjectPick({ ...subjectPick, [s.subjectId]: e.target.value })}
                    >
                      <option value="">Choose a teacher</option>
                      {s.candidates.map((c) => (
                        <option key={c.id} value={c.id} disabled={!c.eligible}>
                          {c.name}{c.eligible ? '' : ` — ${c.reason}`}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            <p className="hint">
              A subject can only go to a teacher who already teaches it, is free at that hour, and stays
              within their own daily period limit. Anyone who cannot is listed with the reason.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn btn-secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" type="button" onClick={deactivate} disabled={busy || !everythingChosen}>
                {busy ? 'Handing over...' : 'Hand over and deactivate'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function TeachersPage() {
  const [teachers, setTeachers] = useState([]);
  const [search, setSearch] = useState('');
  const [editingTeacher, setEditingTeacher] = useState(null); // null | 'new' | teacher
  const [statusTeacher, setStatusTeacher] = useState(null); // the row whose Activate/Deactivate was clicked
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    getTeachers(search).then(setTeachers).catch((err) => setError(err.response?.data?.message || 'Could not load teachers.'));
  }, [search]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(form) {
    await createTeacher({ ...form, subjectIds: form.subjectIds });
    setEditingTeacher(null);
    load();
  }

  async function handleEdit(form) {
    const updated = await updateTeacher(editingTeacher.id, form);
    setEditingTeacher(null);
    if (updated.clearedSchedules > 0) {
      setNotice(`${updated.clearedSchedules} class assignment${updated.clearedSchedules === 1 ? '' : 's'} removed since this teacher is now marked retired.`);
    } else {
      setNotice('');
    }
    load();
  }

  async function openEdit(t) {
    setError('');
    // The list row only carries subject/grade *names* for display —
    // editing needs the real record (degree, major, sex, address,
    // contact number, and actual subject ids), or the form would
    // silently reopen blank and overwrite all of that on save.
    try {
      const full = await getTeacher(t.id);
      setEditingTeacher(full);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load this teacher.');
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Teachers</h1>
          <p>See each teacher's subjects, grade levels, and weekly load before assigning a new class.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditingTeacher('new')}>+ Add Teacher</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>{notice}</div>}

      <div className="search-box">
        <Search size={15} className="search-box-icon" />
        <input
          className="admin-search-input" placeholder="Search by full name or email..."
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card card-flush">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Teacher</th><th>Grade Levels</th><th>Weekly Load</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {teachers.map((t) => {
                const pct = Math.min(100, (t.weekly_load / t.weekly_load_cap) * 100);
                const full = t.weekly_load >= t.weekly_load_cap;
                return (
                  <tr key={t.id}>
                    <td>
                      <b>{t.last_name}, {t.first_name}</b>
                      <div className="cell-sub">{(t.subjects || []).join(', ') || '—'}</div>
                      <div className="cell-sub">
                        {t.email || <span className="muted">{NO_EMAIL}</span>}
                      </div>
                    </td>
                    <td>{(t.grade_levels || []).join(', ') || '—'}</td>
                    <td style={{ minWidth: 160 }}>
                      <div style={{ fontSize: 13, marginBottom: 3 }}>{t.weekly_load}/{t.weekly_load_cap} periods</div>
                      <div className="grade-card-fill-bar" style={{ margin: 0 }}>
                        <div style={{ width: `${pct}%`, background: full ? 'var(--danger)' : 'var(--accent)' }} />
                      </div>
                    </td>
                    <td>
                      {!t.is_active ? <span className="pill pill-draft">Inactive</span>
                        : t.status === 'retired' ? <span className="pill pill-draft">Retired</span>
                          : t.status === 'locked' ? <span className="pill pill-open" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>Locked</span>
                            : full ? <span className="pill pill-needs_revision">Fully booked</span>
                              : <span className="pill pill-approved">Available</span>}
                    </td>
                    <td>
                      <button className="link-action" onClick={() => openEdit(t)} style={{ marginRight: 10 }}>Edit</button>
                      <button
                        className={`btn btn-sm ${t.is_active ? 'btn-outline-danger' : 'btn-secondary'}`}
                        style={{ marginRight: 10 }}
                        onClick={() => { setNotice(''); setStatusTeacher(t); }}
                      >
                        {t.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      {/* A teacher who is no longer teaching has no current
                          schedule to look at, and cannot be given one. */}
                      {t.is_active && t.status === 'active'
                        ? <Link to={`/admin/teachers/${t.id}`}>View schedule</Link>
                        : (
                          <span className="muted" title="This teacher is not active, so they have no current classes."
                            style={{ cursor: 'not-allowed', opacity: 0.55 }} aria-disabled="true">
                            View schedule
                          </span>
                        )}
                    </td>
                  </tr>
                );
              })}
              {teachers.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>No teachers yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingTeacher && (
        <TeacherFormModal
          mode={editingTeacher === 'new' ? 'create' : 'edit'}
          teacher={editingTeacher === 'new' ? null : editingTeacher}
          onClose={() => setEditingTeacher(null)}
          onSubmit={editingTeacher === 'new' ? handleCreate : handleEdit}
        />
      )}

      {statusTeacher && (
        <TeacherStatusDialog
          teacher={statusTeacher}
          onClose={() => setStatusTeacher(null)}
          onDone={(message) => { setStatusTeacher(null); setNotice(message); load(); }}
        />
      )}
    </div>
  );
}
