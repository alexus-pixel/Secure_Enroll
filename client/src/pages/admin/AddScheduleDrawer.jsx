import { useEffect, useMemo, useState } from 'react';
import { checkScheduleConflict, createScheduleEntry, updateScheduleEntry } from '../../api/admin';

const DAYS = [{ n: 1, l: 'M' }, { n: 2, l: 'T' }, { n: 3, l: 'W' }, { n: 4, l: 'T' }, { n: 5, l: 'F' }];

// "07:00" -> "7:00 AM" — display only; form.startTime/endTime stay
// in 24h HH:MM since that's what the API expects.
function to12Hour(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

export default function AddScheduleDrawer({
  sectionId, subjects, teachers, entry, initialSession, initialStartTime, initialEndTime, onClose, onSaved,
}) {
  const [form, setForm] = useState({
    subjectId: entry?.subject_id || subjects[0]?.id || '',
    session: entry?.session || initialSession || 'morning',
    days: entry?.days || [],
    startTime: entry?.start_time?.slice(0, 5) || initialStartTime || '',
    endTime: entry?.end_time?.slice(0, 5) || initialEndTime || '',
    teacherId: entry?.teacher_id || '',
    room: entry?.room || '',
  });
  const [availability, setAvailability] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const canCheck = form.teacherId && form.days.length > 0 && form.startTime && form.endTime;

  useEffect(() => {
    if (!canCheck) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(teachers.map(async (t) => {
        try {
          const { available, reason } = await checkScheduleConflict({
            teacherId: t.id, days: form.days.join(','),
            startTime: form.startTime, endTime: form.endTime, excludeEntryId: entry?.id,
          });
          return { teacher: t, available, reason };
        } catch {
          return { teacher: t, available: null, reason: null };
        }
      }));
      if (!cancelled) setAvailability(results);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCheck, form.days.join(','), form.startTime, form.endTime]);

  // Derived, not stored: avoids a second effect whose only job was
  // to mirror `availability` into a `conflict` field.
  const conflict = useMemo(() => {
    if (!form.teacherId) return null;
    const row = availability.find((a) => a.teacher.id === Number(form.teacherId));
    return row && row.available === false ? row : null;
  }, [form.teacherId, availability]);

  // A teacher already at their daily cap for one of the picked days
  // is not offered as a pickable option at all — same treatment as
  // an outright time conflict, since selecting them would just get
  // rejected on save anyway. The full availability list below still
  // shows why each one is or isn't listed.
  function isUnavailable(teacherId) {
    const row = availability.find((a) => a.teacher.id === teacherId);
    return row ? row.available === false : false;
  }

  function toggleDay(n) {
    setForm((f) => ({ ...f, days: f.days.includes(n) ? f.days.filter((d) => d !== n) : [...f.days, n] }));
  }

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      const payload = { ...form, sectionId, roleType: 'subject' };
      const result = entry
        ? await updateScheduleEntry(entry.id, payload)
        : await createScheduleEntry(payload);
      onSaved(result);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save this schedule entry.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer-panel">
        <div className="modal-head">
          <div>
            <h2 style={{ marginBottom: 2 }}>{entry ? 'Edit' : 'Add'} Subject Schedule</h2>
            {form.startTime && form.endTime && (
              <p className="cell-sub" style={{ margin: 0 }}>
                {to12Hour(form.startTime)}&ndash;{to12Hour(form.endTime)}
              </p>
            )}
          </div>
          <button className="btn-ghost" onClick={onClose} type="button">Close</button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="field">
          <label className="label">Subject</label>
          <select className="input" value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: Number(e.target.value) })}>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="field">
          <label className="label">Session</label>
          <div className="btn-row">
            {['morning', 'afternoon'].map((s) => (
              <button
                key={s} type="button"
                className={`btn btn-sm ${form.session === s ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setForm({ ...form, session: s })}
              >
                {s === 'morning' ? 'Morning' : 'Afternoon'}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label">Day(s) of week</label>
          <div className="day-picker">
            {DAYS.map((d) => (
              <button
                key={d.n} type="button"
                className={`day-chip${form.days.includes(d.n) ? ' is-selected' : ''}`}
                onClick={() => toggleDay(d.n)}
              >
                {d.l}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label">Teacher</label>
          <select className="input" value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: Number(e.target.value) })}>
            <option value="">Select a teacher</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id} disabled={canCheck && isUnavailable(t.id)}>
                {t.last_name}, {t.first_name}{canCheck && isUnavailable(t.id) ? ' \u2014 unavailable' : ''}
              </option>
            ))}
          </select>

          {canCheck && (
            <div style={{ marginTop: 8 }}>
              {availability.map(({ teacher, available, reason }) => (
                <div key={teacher.id} className="availability-row">
                  <span>{teacher.last_name}, {teacher.first_name}</span>
                  <span>
                    <span className={`availability-dot ${available === false ? 'busy' : 'free'}`} />
                    {available === null ? 'Unknown' : available ? 'Available' : reason === 'daily_cap' ? 'At daily cap' : 'Conflict'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {conflict && (
          <div className="alert alert-error">
            {conflict.reason === 'daily_cap' ? (
              <><b>Daily limit reached.</b> This teacher is already at their maximum periods for one of the selected days.</>
            ) : (
              <><b>Scheduling conflict.</b> This teacher already has a class at this day/time in another grade or section.</>
            )}
          </div>
        )}

        <div className="field">
          <label className="label">Room</label>
          <input className="input" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} />
        </div>

        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary" type="button" onClick={handleSave}
            disabled={saving || !!conflict || !form.subjectId || !form.teacherId || form.days.length === 0}
          >
            {saving ? 'Saving...' : 'Save schedule'}
          </button>
        </div>
        {conflict && <p className="cell-warn" style={{ marginTop: 8 }}>Resolve the conflict to save.</p>}
      </div>
    </>
  );
}