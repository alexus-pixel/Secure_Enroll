import { useEffect, useState } from 'react';
import { useParams, Link, useOutletContext } from 'react-router-dom';
import {
  getTeacher, getTeacherAssignments, getGradeScheduleSummary, getSectionsForGrade,
  getSubjectsForGrade, createScheduleEntry, updateScheduleEntry, deleteScheduleEntry,
} from '../../api/admin';

const DAYS = [{ n: 1, l: 'M' }, { n: 2, l: 'T' }, { n: 3, l: 'W' }, { n: 4, l: 'T' }, { n: 5, l: 'F' }];

function blankRow() {
  return {
    key: crypto.randomUUID(), id: null, roleType: 'subject',
    gradeLevelId: '', sectionId: '', subjectId: '', session: 'morning',
    days: [], startTime: '', endTime: '', conflictMessage: null,
  };
}

export default function EditTeacherAssignmentsPage() {
  const { teacherId } = useParams();
  const { setCrumb } = useOutletContext();
  const [teacher, setTeacher] = useState(null);
  const [gradeLevels, setGradeLevels] = useState([]);
  const [sectionsByGrade, setSectionsByGrade] = useState({});
  const [subjectsByGrade, setSubjectsByGrade] = useState({});
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setCrumb('Edit Assignments');
    getTeacher(teacherId).then(setTeacher).catch(() => {});
    getGradeScheduleSummary().then(setGradeLevels).catch(() => {});
    getTeacherAssignments(teacherId).then((assignments) => {
      setRows(assignments.map((a) => ({
        key: crypto.randomUUID(), id: a.id, roleType: a.role_type,
        gradeLevelId: '', sectionId: a.section_id, subjectId: a.subject_id || '',
        session: a.session || 'morning', days: a.days || [],
        startTime: a.start_time?.slice(0, 5) || '', endTime: a.end_time?.slice(0, 5) || '',
        conflictMessage: null,
        sectionLabel: `${a.grade_level_name} \u2013 ${a.section_name}`, subjectLabel: a.subject_name,
      })));
    }).catch(() => {});
    return () => setCrumb('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId]);

  async function ensureSectionsLoaded(gradeLevelId) {
    if (!gradeLevelId || sectionsByGrade[gradeLevelId]) return;
    const [secs, subs] = await Promise.all([getSectionsForGrade(gradeLevelId), getSubjectsForGrade(gradeLevelId)]);
    setSectionsByGrade((m) => ({ ...m, [gradeLevelId]: secs }));
    setSubjectsByGrade((m) => ({ ...m, [gradeLevelId]: subs }));
  }

  function updateRow(key, patch) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, conflictMessage: null } : r)));
  }

  function toggleDay(key, n) {
    setRows((rs) => rs.map((r) => {
      if (r.key !== key) return r;
      const days = r.days.includes(n) ? r.days.filter((d) => d !== n) : [...r.days, n];
      return { ...r, days, conflictMessage: null };
    }));
  }

  async function removeRow(row) {
    if (row.id) await deleteScheduleEntry(row.id);
    setRows((rs) => rs.filter((r) => r.key !== row.key));
  }

  async function handleSave() {
    setError('');

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.sectionId) return setError(`Row ${i + 1}: pick a section.`);
      if (row.roleType === 'subject') {
        if (!row.subjectId) return setError(`Row ${i + 1}: pick a subject.`);
        if (!row.startTime || !row.endTime) return setError(`Row ${i + 1}: set a start and end time.`);
      }
      if (row.days.length === 0) return setError(`Row ${i + 1}: pick at least one day.`);
    }

    setSaving(true);
    let hadConflict = false;
    const nextRows = [...rows];

    for (let i = 0; i < nextRows.length; i++) {
      const row = nextRows[i];
      const payload = {
        sectionId: row.sectionId, subjectId: row.subjectId || undefined, teacherId: Number(teacherId),
        roleType: row.roleType, session: row.roleType === 'adviser' ? undefined : row.session,
        days: row.days, startTime: row.roleType === 'adviser' ? undefined : row.startTime,
        endTime: row.roleType === 'adviser' ? undefined : row.endTime,
      };
      try {
        const result = row.id
          ? await updateScheduleEntry(row.id, payload)
          : await createScheduleEntry(payload);
        if (result?.conflict || result === undefined) {
          nextRows[i] = { ...row, conflictMessage: 'Conflicts with this teacher\u2019s existing schedule.' };
          hadConflict = true;
        } else if (result?.entry?.id && !row.id) {
          nextRows[i] = { ...row, id: result.entry.id };
        }
      } catch (err) {
        if (err.response?.status === 409) {
          nextRows[i] = { ...row, conflictMessage: err.response.data.message };
          hadConflict = true;
        } else {
          setError(err.response?.data?.message || 'Could not save assignments.');
        }
      }
    }
    setRows(nextRows);
    setSaving(false);
    if (hadConflict) setError('Resolve the conflict above to save.');
  }

  if (!teacher) return <div className="empty-state">Loading...</div>;

  return (
    <div>
      <Link to="/admin/teachers" className="back-link">&larr; Back to Teacher Assignments</Link>
      <h1>{teacher.first_name} {teacher.last_name}</h1>
      <p className="muted">{teacher.email}</p>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="section-label">Assignments</div>
        {rows.map((row) => (
          <div
            key={row.key}
            className="card"
            style={{ margin: '0 0 12px', padding: 14, borderColor: row.conflictMessage ? 'var(--danger)' : 'var(--border)', background: row.conflictMessage ? 'var(--danger-soft)' : 'var(--surface)' }}
          >
            <div className="field-grid cols-3">
              <div>
                <label className="label">Grade level</label>
                <select
                  className="input" value={row.gradeLevelId}
                  onChange={(e) => { updateRow(row.key, { gradeLevelId: Number(e.target.value), sectionId: '', subjectId: '' }); ensureSectionsLoaded(Number(e.target.value)); }}
                >
                  <option value="">{row.sectionLabel || 'Select'}</option>
                  {gradeLevels.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Section</label>
                <select className="input" value={row.sectionId} onChange={(e) => updateRow(row.key, { sectionId: Number(e.target.value) })} disabled={!row.gradeLevelId}>
                  <option value="">Select</option>
                  {(sectionsByGrade[row.gradeLevelId] || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Role</label>
                <select className="input" value={row.roleType} onChange={(e) => updateRow(row.key, { roleType: e.target.value })}>
                  <option value="subject">Subject</option>
                  <option value="adviser">Adviser (all subjects)</option>
                </select>
              </div>
            </div>

            {row.roleType === 'subject' && (
              <>
                <div className="field-grid cols-3">
                  <div>
                    <label className="label">Subject</label>
                    <select className="input" value={row.subjectId} onChange={(e) => updateRow(row.key, { subjectId: Number(e.target.value) })} disabled={!row.gradeLevelId}>
                      <option value="">{row.subjectLabel || 'Select'}</option>
                      {(subjectsByGrade[row.gradeLevelId] || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div><label className="label">Start</label>
                    <input className="input" type="time" value={row.startTime} onChange={(e) => updateRow(row.key, { startTime: e.target.value })} /></div>
                  <div><label className="label">End</label>
                    <input className="input" type="time" value={row.endTime} onChange={(e) => updateRow(row.key, { endTime: e.target.value })} /></div>
                </div>
                <div className="day-picker" style={{ marginBottom: 10 }}>
                  {DAYS.map((d) => (
                    <button
                      key={d.n} type="button"
                      className={`day-chip${row.days.includes(d.n) ? ' is-selected' : ''}`}
                      onClick={() => toggleDay(row.key, d.n)}
                    >
                      {d.l}
                    </button>
                  ))}
                </div>
              </>
            )}

            {row.conflictMessage && (
              <p className="cell-warn" style={{ marginBottom: 8 }}>{row.conflictMessage}</p>
            )}
            <button className="btn btn-outline-danger btn-sm" onClick={() => removeRow(row)}>Remove</button>
          </div>
        ))}

        <button className="btn btn-secondary" onClick={() => setRows((rs) => [...rs, blankRow()])}>+ Add Assignment</button>
      </div>

      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : 'Save Assignments'}
      </button>
    </div>
  );
}