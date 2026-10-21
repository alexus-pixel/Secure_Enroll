import { useEffect, useMemo, useState } from 'react';
import { checkScheduleConflict, createScheduleEntry, updateScheduleEntry } from '../../api/admin';
import { getGradeSubjects } from '../../api/subjects';
import ConfirmDialog from '../../components/ConfirmDialog';

const DAYS = [{ n: 1, l: 'M' }, { n: 2, l: 'T' }, { n: 3, l: 'W' }, { n: 4, l: 'T' }, { n: 5, l: 'F' }];
const DAY_NAMES = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };
const SESSION_LABELS = { morning: 'Morning', afternoon: 'Afternoon' };

// The school building is open 6:00 in the morning to 6:00 in the evening, and
// every period has to sit inside that. Kept in step with
// server/validators/scheduleValidators.js, which is the one that decides.
export const DAY_OPENS = '06:00';
export const DAY_CLOSES = '18:00';
const clock = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export const SCHOOL_HOURS = `${clock(DAY_OPENS)} to ${clock(DAY_CLOSES)}`;

// "07:00" -> "7:00 AM" — display only; form.startTime/endTime stay
// in 24h HH:MM since that's what the API expects.
export function to12Hour(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * The same session/time rule the server enforces (see
 * server/validators/scheduleValidators.js), so a 9 PM "morning"
 * period is refused here before the request is ever sent — and with
 * the same wording when the server refuses it anyway.
 *
 *   morning   - starts AND ends before 12:00 noon
 *   afternoon - starts at 12:00 noon or later
 *
 * Returns null when the times fit, or a sentence naming the session.
 * Exported because the "+ Add Period" row on the grade's schedule
 * page — where the hours are actually typed — checks the same thing.
 */
/**
 * Which half of the day a period belongs to, read off its start time:
 * before 12:00 noon is the morning session, 12:00 noon or later is the
 * afternoon one.
 *
 * Nobody is asked for this any more. It used to be a pair of buttons in
 * this drawer, which only ever gave the admin a way to disagree with the
 * clock — the time is already being set, so the session follows from it.
 * The value is still sent and still stored, because the grade schedule
 * page shows the week as a Morning card and an Afternoon card and needs
 * something to sort the periods into.
 */
export function sessionForTime(startTime) {
  if (!startTime) return null;
  return String(startTime).slice(0, 5) >= '12:00' ? 'afternoon' : 'morning';
}

export function sessionTimeIssue(session, startTime, endTime) {
  const start = startTime ? String(startTime).slice(0, 5) : null;
  const end = endTime ? String(endTime).slice(0, 5) : null;
  if (start && end && start >= end) return 'End time must be after start time.';
  // School hours, which hold whatever the session says and before one is picked.
  if (start && start < DAY_OPENS) return `Classes do not start before ${clock(DAY_OPENS)}. School hours are ${SCHOOL_HOURS}.`;
  if (start && start >= DAY_CLOSES) return `A period cannot start at ${clock(DAY_CLOSES)} or later. School hours are ${SCHOOL_HOURS}.`;
  if (end && end > DAY_CLOSES) return `A period has to end by ${clock(DAY_CLOSES)}. School hours are ${SCHOOL_HOURS}.`;
  if (end && end <= DAY_OPENS) return `A period cannot end at or before ${clock(DAY_OPENS)}. School hours are ${SCHOOL_HOURS}.`;
  if (!SESSION_LABELS[session]) return null;
  if (session === 'morning') {
    if (start && start >= '12:00') return 'A Morning session period must start before 12:00 noon.';
    if (end && end >= '12:00') return 'A Morning session period must end before 12:00 noon.';
    return null;
  }
  if (start && start < '12:00') return 'An Afternoon session period must start at 12:00 noon or later.';
  return null;
}

export default function AddScheduleDrawer({
  sectionId, gradeLevelId, schoolYearId, sectionName, adviserName,
  subjects = [], teachers, entry, initialSession, initialStartTime, initialEndTime, onClose, onSaved,
}) {
  // An adviser period represents "owns this section all day" and
  // carries no subject at all, so the subject field is left out
  // rather than demanded when one is being edited.
  const roleType = entry?.role_type === 'adviser' ? 'adviser' : 'subject';
  const isAdviserPeriod = roleType === 'adviser';

  const [form, setForm] = useState({
    subjectId: entry?.subject_id || '',
    days: entry?.days || [],
    startTime: entry?.start_time?.slice(0, 5) || initialStartTime || '',
    endTime: entry?.end_time?.slice(0, 5) || initialEndTime || '',
    teacherId: entry?.teacher_id || '',
    room: entry?.room || '',
  });
  // The subjects this grade level actually has in this school year —
  // the dropdown's options. The list handed down from the page is
  // used as the starting point so there is no empty flash, then this
  // read keeps it right even if the page has not loaded it yet.
  const [subjectOptions, setSubjectOptions] = useState(subjects);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [subjectsError, setSubjectsError] = useState('');
  const [availability, setAvailability] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!gradeLevelId || isAdviserPeriod) return;
    let cancelled = false;
    setSubjectsLoading(true);
    getGradeSubjects(gradeLevelId, schoolYearId)
      .then((list) => { if (!cancelled) { setSubjectOptions(list); setSubjectsError(''); } })
      .catch(() => { if (!cancelled) setSubjectsError('Could not load this grade level’s subjects.'); })
      .finally(() => { if (!cancelled) setSubjectsLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradeLevelId, schoolYearId]);

  // The period's session, read off its start time rather than asked for.
  // The times themselves come from the period row that was clicked (or from
  // the entry being edited), so this is settled before the drawer opens; the
  // fallbacks only matter for a row that somehow carries no time at all.
  const session = sessionForTime(form.startTime) || entry?.session || initialSession || 'morning';

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

  // What is wrong with this period's hours — shown under the time line, and
  // the save button stays disabled while it stands. The session half of the
  // rule cannot fail any more now that the session is read off the start
  // time; school hours and "end after start" still can.
  const sessionIssue = useMemo(
    () => (isAdviserPeriod ? null : sessionTimeIssue(session, form.startTime, form.endTime)),
    [isAdviserPeriod, session, form.startTime, form.endTime],
  );

  // A teacher already at their daily cap for one of the picked days
  // is not offered as a pickable option at all — same treatment as
  // an outright time conflict, since selecting them would just get
  // rejected on save anyway. The full availability list below still
  // shows why each one is or isn't listed.
  function isUnavailable(teacherId) {
    const row = availability.find((a) => a.teacher.id === teacherId);
    return row ? row.available === false : false;
  }

  // Most periods run every school day, and ticking five chips one at a time
  // for each of them is the long way round. The box is driven by the chips
  // rather than kept beside them as its own flag, so the two can never
  // disagree — and a half-picked week shows as a dash rather than as a tick
  // that would clear the days it looks like it is already holding.
  const allWeekdays = DAYS.every((d) => form.days.includes(d.n));
  const someWeekdays = form.days.length > 0;
  function toggleWholeWeek(checked) {
    setForm((f) => ({ ...f, days: checked ? DAYS.map((d) => d.n) : [] }));
  }

  function toggleDay(n) {
    setForm((f) => ({ ...f, days: f.days.includes(n) ? f.days.filter((d) => d !== n) : [...f.days, n] }));
  }

  const selectedSubject = subjectOptions.find((s) => String(s.id) === String(form.subjectId));
  const selectedTeacher = teachers.find((t) => String(t.id) === String(form.teacherId));
  const dayList = [...form.days].sort().map((d) => DAY_NAMES[d]).join(', ');
  const timeRange = form.startTime && form.endTime
    ? `${to12Hour(form.startTime)}–${to12Hour(form.endTime)}` : '—';

  const incomplete = saving || !!conflict || !!sessionIssue || !form.teacherId
    || form.days.length === 0 || (!isAdviserPeriod && !form.subjectId);

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      // session is derived, not held in form state, so it is added here —
      // the column is still written, and an older row filed under the wrong
      // half of the day is corrected on the way past.
      const payload = { ...form, session, sectionId, roleType };
      if (isAdviserPeriod) payload.subjectId = null;
      const result = entry
        ? await updateScheduleEntry(entry.id, payload)
        : await createScheduleEntry(payload);
      setConfirming(false);
      onSaved(result);
    } catch (err) {
      const data = err.response?.data;
      setError(data?.errors?.map((x) => x.message).join(' ') || data?.message
        || 'Could not save this schedule entry.');
      setConfirming(false);
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
            {sectionName && (
              <p className="muted" style={{ margin: '2px 0 0', fontSize: 13.5 }}>
                {sectionName} &middot; Adviser: {adviserName || 'No adviser assigned yet'}
              </p>
            )}
          </div>
          <button className="btn-ghost" onClick={onClose} type="button">Close</button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {isAdviserPeriod ? (
          <div className="field">
            <label className="label">Subject</label>
            <p className="hint" style={{ margin: 0 }}>
              This is an adviser period &mdash; it covers the whole section, so it carries no subject.
            </p>
          </div>
        ) : (
          <div className="field">
            <label className="label" htmlFor="schedule-subject">Subject</label>
            <select
              id="schedule-subject" className="input" value={form.subjectId}
              onChange={(e) => setForm({ ...form, subjectId: e.target.value ? Number(e.target.value) : '' })}
              disabled={subjectsLoading && subjectOptions.length === 0}
            >
              <option value="">
                {subjectsLoading && subjectOptions.length === 0 ? 'Loading subjects…' : 'Select a subject'}
              </option>
              {subjectOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.is_domain ? ' (learning domain)' : ''}</option>
              ))}
            </select>
            {subjectsError
              ? <p className="field-error">{subjectsError}</p>
              : subjectOptions.length === 0 && !subjectsLoading
                ? <p className="hint">This grade level has no subjects yet &mdash; add one in the Subjects panel first.</p>
                : <p className="hint">Only this grade level&rsquo;s subjects for this school year can be scheduled here.</p>}
          </div>
        )}

        {/* There is no session to pick: the period already has a time, and
            the half of the day follows from it. What is left is a read-back
            of that time, plus anywhere the hours themselves are wrong. */}
        <div className="field">
          <label className="label">Time</label>
          <p style={{ margin: 0 }}>
            {timeRange}{' '}
            <span className="muted">({SESSION_LABELS[session]} session)</span>
          </p>
          {sessionIssue
            ? <p className="field-error">{sessionIssue}</p>
            : <p className="hint">Set on the period itself, on the grade&rsquo;s schedule. School hours are {SCHOOL_HOURS}.</p>}
        </div>

        <div className="field">
          <label className="label">Day(s) of week</label>
          <label className="check-row" style={{ marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={allWeekdays}
              // indeterminate is not an attribute, only a property, so it is
              // set on the element itself — this is the dash that says "some
              // days, not all".
              ref={(el) => { if (el) el.indeterminate = someWeekdays && !allWeekdays; }}
              onChange={(e) => toggleWholeWeek(e.target.checked)}
            />
            <span>Monday to Friday</span>
          </label>
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
                {t.last_name}, {t.first_name}{canCheck && isUnavailable(t.id) ? ' — unavailable' : ''}
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
            className="btn btn-primary" type="button" onClick={() => setConfirming(true)}
            disabled={incomplete}
          >
            {saving ? 'Saving...' : 'Save schedule'}
          </button>
        </div>
        {conflict && <p className="cell-warn" style={{ marginTop: 8 }}>Resolve the conflict to save.</p>}
        {sessionIssue && <p className="cell-warn" style={{ marginTop: 8 }}>Fix the period’s time to save.</p>}
      </div>

      {/* Saving a period changes what a whole class and a teacher do
          every week, so the drawer says back exactly what is about to
          be written before it writes it. */}
      {confirming && (
        <ConfirmDialog
          title={entry ? 'Save this change to the period?' : 'Save this period?'}
          confirmLabel={entry ? 'Save change' : 'Save period'}
          tone="primary"
          busy={saving}
          onConfirm={handleSave}
          onClose={() => !saving && setConfirming(false)}
        >
          <p style={{ marginTop: 0 }}>
            {entry ? 'This period will be saved as:' : 'This period will be added as:'}
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li><b>Section:</b> {sectionName || `#${sectionId}`}</li>
            <li>
              <b>Subject:</b>{' '}
              {isAdviserPeriod ? 'Adviser (whole section, no subject)' : (selectedSubject?.name || '—')}
            </li>
            <li>
              <b>Teacher:</b>{' '}
              {selectedTeacher ? `${selectedTeacher.last_name}, ${selectedTeacher.first_name}` : '—'}
            </li>
            <li><b>Days:</b> {dayList || '—'}</li>
            <li>
              <b>Time:</b> {timeRange}{' '}
              <span className="muted">({SESSION_LABELS[session] || session} session)</span>
            </li>
            {form.room && <li><b>Room:</b> {form.room}</li>}
          </ul>
        </ConfirmDialog>
      )}
    </>
  );
}
