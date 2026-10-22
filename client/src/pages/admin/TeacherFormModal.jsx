import { useEffect, useState } from 'react';
import { getAllSubjects, getDegreeOptions, checkTeacherEmail } from '../../api/admin';
import { sanitizePhone } from '../../utils/validators';

const OTHER_CODE = 'OTHER';

export default function TeacherFormModal({ mode, teacher, onClose, onSubmit }) {
  const [degreeOptions, setDegreeOptions] = useState([]); // [{ degree, label, majors }]
  const [subjectsByGrade, setSubjectsByGrade] = useState([]); // [{ name, items: [...] }]
  const [degreeSelection, setDegreeSelection] = useState(''); // one of the known codes, or OTHER_CODE, or ''
  const [customDegree, setCustomDegree] = useState('');
  const [form, setForm] = useState({
    firstName: teacher?.first_name || '',
    middleName: teacher?.middle_name || '',
    lastName: teacher?.last_name || '',
    email: teacher?.email || '',
    contactNumber: teacher?.contact_number || '',
    major: teacher?.major || '',
    dateHired: teacher?.date_hired?.slice(0, 10) || '',
    sex: teacher?.sex || '',
    prcLicenseNumber: teacher?.prc_license_number || '',
    address: teacher?.address || '',
    maxPeriodsPerDay: teacher?.max_periods_per_day || 8,
    subjectIds: teacher?.subject_ids ? [...teacher.subject_ids] : [],
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // A PRC professional licence number is seven digits. An empty box is fine:
  // not every teacher on file has one recorded.
  const prcProblem = form.prcLicenseNumber && !/^\d{7}$/.test(form.prcLicenseNumber)
    ? 'PRC license number must be exactly 7 digits.' : '';
  // A teacher handles one to eight periods a day. The server holds the same
  // range; this is only so the form says so before Save is pressed.
  const periodsProblem = (() => {
    const n = Number(form.maxPeriodsPerDay);
    if (!Number.isInteger(n)) return 'Periods per day must be a whole number.';
    if (n < 1) return 'A teacher handles at least 1 period a day.';
    if (n > 8) return 'A teacher handles at most 8 periods a day.';
    return '';
  })();

  // idle | checking | ok | error — drives the inline red message
  // under Email and whether Save is allowed to proceed. This runs
  // on blur, not on every keystroke, so it isn't hammering the
  // verification API's monthly free-tier quota while someone is
  // still mid-typing.
  const [emailCheckState, setEmailCheckState] = useState('idle');
  const [emailCheckMessage, setEmailCheckMessage] = useState('');

  useEffect(() => {
    getDegreeOptions().then((options) => {
      setDegreeOptions(options);
      // A previously-saved degree that isn't one of the known codes
      // is custom text an admin typed after choosing "Other" — the
      // dropdown should show "Other" selected, with that text
      // restored into the free-text field below it.
      if (teacher?.degree) {
        const known = options.some((d) => d.degree === teacher.degree && d.degree !== OTHER_CODE);
        setDegreeSelection(known ? teacher.degree : OTHER_CODE);
        if (!known) setCustomDegree(teacher.degree);
      }
    }).catch(() => setDegreeOptions([]));

    getAllSubjects().then((subjects) => {
      const groups = new Map();
      for (const s of subjects) {
        if (!groups.has(s.grade_level_id)) groups.set(s.grade_level_id, { name: s.grade_level_name, items: [] });
        groups.get(s.grade_level_id).items.push(s);
      }
      setSubjectsByGrade([...groups.values()]);
    }).catch(() => setSubjectsByGrade([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subjects this teacher is still scheduled to teach in the active
  // school year. The server refuses to un-assign them (the class
  // would be left without a teacher), so the checkbox is shown
  // ticked and disabled with the reason, rather than letting the
  // admin untick it and only then hit the error on Save.
  const lockedById = new Map(
    (teacher?.lockedSubjects || []).map((l) => [Number(l.subjectId), l])
  );

  const isOther = degreeSelection === OTHER_CODE;
  const majorsForSelectedDegree = degreeOptions.find((d) => d.degree === degreeSelection)?.majors || [];
  const allSubjects = subjectsByGrade.flatMap((g) => g.items);
  const allSelected = allSubjects.length > 0 && allSubjects.every((s) => form.subjectIds.includes(s.id));

  function handleDegreeChange(code) {
    setDegreeSelection(code);
    setForm({ ...form, major: '' }); // old major almost certainly doesn't belong to the newly picked degree
    if (code !== OTHER_CODE) setCustomDegree('');
  }

  // Several majors (BSEd's English, Filipino, Mathematics, Science,
  // Social Studies, MAPEH, Values Education) are named after exactly
  // the subjects they qualify someone to teach, so picking one can
  // usefully pre-check every subject across every grade sharing
  // that name. This only adds to the current selection — it never
  // un-checks something already picked by hand, so switching majors
  // to explore options can't quietly lose earlier choices.
  function handleMajorChange(newMajor) {
    const matchIds = allSubjects.filter((s) => s.name.toLowerCase() === newMajor.toLowerCase()).map((s) => s.id);
    setForm((f) => ({
      ...f, major: newMajor,
      subjectIds: matchIds.length ? [...new Set([...f.subjectIds, ...matchIds])] : f.subjectIds,
    }));
  }

  function toggleSelectAll() {
    // Clearing the lot still leaves the locked ones ticked — they
    // cannot be removed while they are on the timetable.
    setForm((f) => ({
      ...f,
      subjectIds: allSelected ? [...lockedById.keys()] : allSubjects.map((s) => s.id),
    }));
  }

  function toggleSubject(id) {
    if (lockedById.has(Number(id))) return;
    setForm((f) => ({
      ...f,
      subjectIds: f.subjectIds.includes(id) ? f.subjectIds.filter((x) => x !== id) : [...f.subjectIds, id],
    }));
  }

  async function handleEmailBlur() {
    const email = form.email.trim();
    // Editing a teacher without changing their email shouldn't
    // re-spend a verification call on an address already on file.
    if (mode === 'edit' && email === teacher?.email) { setEmailCheckState('idle'); return; }
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) { setEmailCheckState('idle'); return; }

    setEmailCheckState('checking');
    try {
      const result = await checkTeacherEmail(email);
      if (result.ok) {
        setEmailCheckState('ok');
        setEmailCheckMessage('');
      } else {
        setEmailCheckState('error');
        setEmailCheckMessage(result.reason || 'That email address does not appear to exist.');
      }
    } catch {
      // A failed check itself isn't treated as a rejection — the
      // server-side check at Save time is still the real gate.
      setEmailCheckState('idle');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      // The literal code "OTHER" is a dropdown sentinel, never a
      // value worth saving — what actually gets submitted as the
      // degree is whatever the admin typed for it.
      const degree = isOther ? customDegree.trim() : degreeSelection;
      if (prcProblem) { setError(prcProblem); return; }
      if (periodsProblem) { setError(periodsProblem); return; }
      await onSubmit({ ...form, degree });
    } catch (err) {
      const data = err.response?.data;
      setError(data?.errors?.map((x) => x.message).join(' ') || data?.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel is-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{mode === 'create' ? 'Add Teacher' : 'Edit Teacher'}</h2>
          <button className="btn-ghost" onClick={onClose} type="button">Close</button>
        </div>
        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field-grid cols-3">
            <div><label className="label">First name</label>
              <input className="input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required /></div>
            <div><label className="label">Middle name / initial</label>
              <input className="input" value={form.middleName} onChange={(e) => setForm({ ...form, middleName: e.target.value })} /></div>
            <div><label className="label">Last name</label>
              <input className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required /></div>
          </div>
          <div className="field-grid cols-2">
            <div>
              <label className="label">Email</label>
              <input
                className="input" type="email" value={form.email}
                placeholder={mode === 'edit' && !teacher?.email ? 'No email address on file' : 'name@gmail.com'}
                onChange={(e) => { setForm({ ...form, email: e.target.value }); setEmailCheckState('idle'); }}
                onBlur={handleEmailBlur}
              />
              {emailCheckState === 'checking' && <p className="hint">Checking this address...</p>}
              {emailCheckState === 'error' && (
                <p style={{ color: 'var(--danger)', fontSize: 13.5, marginTop: 4 }}>{emailCheckMessage}</p>
              )}
              {emailCheckState === 'idle' && (
                <p className="hint">Optional. If given, it is checked against a live email-verification service.</p>
              )}
            </div>
            <div><label className="label">Contact number</label>
              <input className="input" placeholder="09xxxxxxxxx or +639xxxxxxxxx" inputMode="tel" maxLength={13} value={form.contactNumber} onChange={(e) => setForm({ ...form, contactNumber: sanitizePhone(e.target.value) })} required />
              <p className="hint">09XXXXXXXXX (11 digits) or +63XXXXXXXXXX (13 characters).</p></div>
          </div>
          <p className="hint">The email is also where the master list and schedule PDFs get sent from the Teachers page.</p>

          <div className="field-grid cols-2">
            <div>
              <label className="label">Sex</label>
              <select className="input" value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })}>
                <option value="">Prefer not to specify</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </div>
            <div><label className="label">Address</label>
              <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          </div>

          <div className="field-grid cols-3">
            <div>
              <label className="label">Degree</label>
              <select className="input" value={degreeSelection} onChange={(e) => handleDegreeChange(e.target.value)}>
                <option value="">Select degree</option>
                {degreeOptions.map((d) => <option key={d.degree} value={d.degree}>{d.label}</option>)}
              </select>
              {isOther && (
                <input
                  className="input" style={{ marginTop: 6 }} placeholder="Type the specific degree obtained"
                  value={customDegree} onChange={(e) => setCustomDegree(e.target.value)} required
                />
              )}
            </div>
            <div>
              <label className="label">Major</label>
              {isOther ? (
                <input
                  className="input" placeholder="Type the major/specialization"
                  value={form.major} onChange={(e) => setForm({ ...form, major: e.target.value })}
                />
              ) : (
                <select
                  className="input" value={form.major}
                  onChange={(e) => handleMajorChange(e.target.value)}
                  disabled={!degreeSelection}
                >
                  <option value="">{degreeSelection ? 'Select major' : 'Select a degree first'}</option>
                  {majorsForSelectedDegree.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
            </div>
            <div><label className="label">Date hired</label>
              <input className="input" type="date" value={form.dateHired} onChange={(e) => setForm({ ...form, dateHired: e.target.value })} /></div>
          </div>

          <div className={`field-grid ${mode === 'edit' ? 'cols-3' : 'cols-2'}`}>
            <div><label className="label">PRC license number</label>
              <input
                className={`input${prcProblem ? ' input-error' : ''}`}
                placeholder="7 digits, 1234xxx" inputMode="numeric" maxLength={7}
                value={form.prcLicenseNumber}
                onChange={(e) => setForm({ ...form, prcLicenseNumber: e.target.value.replace(/\D/g, '').slice(0, 7) })}
              />
              {prcProblem
                ? <p className="field-error">{prcProblem}</p>
                : <p className="hint">Exactly 7 digits. Leave blank if the teacher has none.</p>}
            </div>
            <div>
              <label className="label">Max periods per day</label>
              <input
                className={`input${periodsProblem ? ' input-error' : ''}`} type="number" min="1" max="8" step="1"
                placeholder="1 to 8, e.g. 8" value={form.maxPeriodsPerDay}
                onChange={(e) => setForm({ ...form, maxPeriodsPerDay: Number(e.target.value) })}
              />
              {periodsProblem ? <p className="field-error">{periodsProblem}</p> : null}
            </div>
            {/* Whether a teacher is still teaching is changed from the list,
                with Deactivate, which first asks what happens to their
                advisory class and their subjects. It is not a quiet dropdown
                in the middle of an edit form. */}
          </div>
          <p className="hint">
            The most periods this teacher can be booked for on any single day, across every grade and section. It must be between 1 and 8, and it is separate from the school-wide weekly cap.
          </p>

          <div className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="label" style={{ margin: 0 }}>Subjects</label>
              {allSubjects.length > 0 && (
                <label className="check-row" style={{ margin: 0, fontSize: 14 }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                  Select all
                </label>
              )}
            </div>
            {subjectsByGrade.length === 0 && (
              <span className="muted" style={{ fontSize: 14 }}>No subjects have been set up yet in Class Schedules.</span>
            )}
            {lockedById.size > 0 && (
              <p className="hint" style={{ marginTop: 0 }}>
                Greyed-out subjects are already on this teacher's timetable this school year. Move those
                periods to another teacher (Teachers &rarr; Deactivate &rarr; transfer, or Class Schedules)
                before they can be removed here.
              </p>
            )}
            {subjectsByGrade.map((group) => (
              <div key={group.name} style={{ marginBottom: 10 }}>
                <div className="cell-sub" style={{ marginBottom: 4 }}>{group.name}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {group.items.map((s) => {
                    const lock = lockedById.get(Number(s.id));
                    const reason = lock
                      ? `Still scheduled: ${lock.periods.join('; ')}. Move those periods to another teacher first.`
                      : undefined;
                    return (
                      <label
                        key={s.id} className="check-row" title={reason}
                        style={{
                          margin: 0, border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px',
                          ...(lock ? { opacity: 0.65, cursor: 'not-allowed', background: 'var(--surface-2, transparent)' } : {}),
                        }}
                      >
                        <input
                          type="checkbox" disabled={!!lock}
                          checked={form.subjectIds.includes(s.id) || !!lock}
                          onChange={() => toggleSubject(s.id)}
                        />
                        {s.name}
                        {lock && <span className="muted" style={{ fontSize: 12.5, marginLeft: 6 }}>(scheduled)</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <button
            className="btn btn-primary" type="submit" style={{ width: '100%', marginTop: 8 }}
            disabled={saving || emailCheckState === 'checking' || emailCheckState === 'error'}
          >
            {saving ? 'Saving...' : mode === 'create' ? 'Add teacher' : 'Save changes'}
          </button>
        </form>
      </div>
    </div>
  );
}