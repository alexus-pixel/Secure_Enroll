import { useEffect, useState } from 'react';
import { adminWalkIn } from '../../api/walkIn';

const emptyForm = {
  isNewStudent: true,
  firstName: '', middleName: '', lastName: '', birthDate: '', sex: '', lrn: '',
  existingStudentId: null,
  guardianEmail: '', confirmEmail: '', guardianFirstName: '', guardianMiddleName: '', guardianLastName: '',
  guardianContactNumber: '', guardianAddress: '', guardianValidIdType: '', relationship: '',
  gradeLevelId: '', sectionId: '',
};

// Shared by the admin and registrar portals: `client` picks which API prefix
// is used, `staffLabel` only changes the wording of the intro line.
export default function WalkInEnrollmentPage({ client = adminWalkIn, staffLabel = 'Admin-assisted' }) {
  const [form, setForm] = useState(emptyForm);
  const [gradeLevels, setGradeLevels] = useState([]);
  const [sections, setSections] = useState([]);
  const [docTypes, setDocTypes] = useState([]);
  const [checkedDocs, setCheckedDocs] = useState([]);
  const [lrnQuery, setLrnQuery] = useState('');
  const [lrnResult, setLrnResult] = useState(null); // null | 'not_found' | student object
  const [lrnSearching, setLrnSearching] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null); // { accountEmail, accountCreated, tempPassword, stillNeeded }
  const [saving, setSaving] = useState(false);
  // Tells the person when the lists could not be loaded, instead of showing
  // an empty drop-down with no explanation.
  const [gradesLoaded, setGradesLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    client.gradeLevels()
      .then((rows) => { setGradeLevels(rows); setGradesLoaded(true); })
      .catch(() => setLoadError('We could not load the grade levels. Please refresh the page or sign in again.'));
    client.documentTypes()
      .then(setDocTypes)
      .catch(() => setLoadError('We could not load the lists for this form. Please refresh the page or sign in again.'));
  }, [client]);

  useEffect(() => {
    if (!form.gradeLevelId) return;
    client.sections(form.gradeLevelId).then(setSections).catch(() => setSections([]));
  }, [client, form.gradeLevelId]);

  function toggleDoc(code) {
    setCheckedDocs((d) => d.includes(code) ? d.filter((x) => x !== code) : [...d, code]);
  }

  function switchMode(isNew) {
    setForm({ ...emptyForm, isNewStudent: isNew, gradeLevelId: form.gradeLevelId, sectionId: form.sectionId });
    setLrnQuery('');
    setLrnResult(null);
    setCheckedDocs([]);
  }

  async function handleLrnSearch(e) {
    e.preventDefault();
    if (!lrnQuery.trim()) return;
    setLrnSearching(true);
    setLrnResult(null);
    try {
      const student = await client.lookupByLrn(lrnQuery.trim());
      setLrnResult(student);
      setForm((f) => ({ ...f, existingStudentId: student.id }));
    } catch (err) {
      setLrnResult(err.response?.status === 404 ? 'not_found' : null);
      if (err.response?.status !== 404) setError(err.response?.data?.message || 'Could not search for that LRN.');
    } finally {
      setLrnSearching(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(null);
    setSaving(true);
    try {
      // Empty strings must become undefined: the server treats a
      // blank sectionId as 0 and rejects it, and a blank LRN as invalid.
      const payload = form.isNewStudent
        ? { ...form, lrn: form.lrn || undefined }
        : { ...form, isNewStudent: false, existingStudentId: form.existingStudentId };
      const result = await client.create({
        ...payload,
        sectionId: form.sectionId || undefined,
        physicalDocTypes: checkedDocs,
      });
      setSuccess(result);
      setForm(emptyForm);
      setCheckedDocs([]);
      setLrnQuery('');
      setLrnResult(null);
    } catch (err) {
      setError(err.response?.data?.errors?.map((x) => x.message).join(' ') || err.response?.data?.message || 'Could not complete this enrollment.');
    } finally {
      setSaving(false);
    }
  }

  const emailTrimmed = form.guardianEmail.trim().toLowerCase();
  const isGmail = /^[^\s@]+@gmail\.com$/.test(emailTrimmed);
  const emailsMatch = emailTrimmed !== '' && emailTrimmed === form.confirmEmail.trim().toLowerCase();

  const studentReady = form.isNewStudent
    ? form.firstName && form.lastName && form.birthDate && form.sex
    : !!form.existingStudentId;
  const canSubmit = !!studentReady && isGmail && emailsMatch;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Walk-in Enrollment</h1>
          <p>{staffLabel} enrollment for a parent completing this in person at the front desk.</p>
        </div>
      </div>

      <div className="alert alert-note">
        <b>A parent account is required.</b> Every walk-in enrollment is linked to a parent account. Enter the
        parent&rsquo;s own Gmail address exactly as they give it to you: that Gmail becomes their login, and the
        application, its status, and any missing requirements show on their dashboard when they sign in.
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && (
        <div className="alert" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
          <b>Enrollment submitted.</b>
          <div style={{ marginTop: 6 }}>
            Parent login: <b>{success.accountEmail}</b>
          </div>
          {success.accountCreated ? (
            <div style={{ marginTop: 4 }}>
              A new parent account was created. Temporary password: <b>{success.tempPassword}</b>.
              Give this to the parent now. It will not be shown again.
            </div>
          ) : (
            <div style={{ marginTop: 4 }}>
              This Gmail already had a parent account, so it was reused. The parent signs in with their existing password.
            </div>
          )}
          {success.stillNeeded?.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              Still needed from the parent (shown as incomplete on their dashboard):
              <ul style={{ margin: '4px 0 0 18px' }}>
                {success.stillNeeded.map((label) => <li key={label}>{label}</li>)}
              </ul>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>All required documents were received.</div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="card">
          <strong>Parent Account</strong>
          <p className="hint">Required. The Gmail entered here is the parent&rsquo;s login for the parent portal.</p>
          <div className="field-grid cols-2" style={{ marginTop: 10 }}>
            <div>
              <label className="label">Parent&rsquo;s Gmail</label>
              <input
                className="input" type="email" placeholder="name@gmail.com" autoComplete="off"
                value={form.guardianEmail}
                onChange={(e) => setForm({ ...form, guardianEmail: e.target.value })} required
              />
              {form.guardianEmail && !isGmail && (
                <p className="hint" style={{ color: 'var(--danger)' }}>Enter a Gmail address ending in @gmail.com.</p>
              )}
            </div>
            <div>
              <label className="label">Confirm Gmail</label>
              <input
                className="input" type="email" placeholder="Re-type the Gmail" autoComplete="off"
                value={form.confirmEmail}
                onChange={(e) => setForm({ ...form, confirmEmail: e.target.value })} required
              />
              {form.confirmEmail && !emailsMatch && (
                <p className="hint" style={{ color: 'var(--danger)' }}>The two Gmail addresses do not match.</p>
              )}
            </div>
          </div>
          <p className="hint">
            Double-check this with the parent. A mistyped address would link the child&rsquo;s application to the wrong person.
            If this Gmail already has a parent account, it is reused and no duplicate is created.
          </p>
          <div className="field-grid cols-3">
            <div><label className="label">First name</label>
              <input className="input" value={form.guardianFirstName} onChange={(e) => setForm({ ...form, guardianFirstName: e.target.value })} required /></div>
            <div><label className="label">Middle name</label>
              <input className="input" value={form.guardianMiddleName} onChange={(e) => setForm({ ...form, guardianMiddleName: e.target.value })} /></div>
            <div><label className="label">Last name</label>
              <input className="input" value={form.guardianLastName} onChange={(e) => setForm({ ...form, guardianLastName: e.target.value })} required /></div>
          </div>
          <div className="field-grid cols-3">
            <div><label className="label">Contact number</label>
              <input className="input" placeholder="09171234567" value={form.guardianContactNumber} onChange={(e) => setForm({ ...form, guardianContactNumber: e.target.value })} required /></div>
            <div><label className="label">Relationship to student</label>
              <input className="input" placeholder="Mother, Father, Guardian..." value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} /></div>
            <div><label className="label">Address</label>
              <input className="input" value={form.guardianAddress} onChange={(e) => setForm({ ...form, guardianAddress: e.target.value })} required /></div>
          </div>
        </div>

        <div className="card">
          <strong>Is this student NEW or ALREADY ENROLLED before?</strong>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button type="button" className={`btn btn-sm ${form.isNewStudent ? 'btn-primary' : 'btn-secondary'}`} onClick={() => switchMode(true)}>
              New Student
            </button>
            <button type="button" className={`btn btn-sm ${!form.isNewStudent ? 'btn-primary' : 'btn-secondary'}`} onClick={() => switchMode(false)}>
              Old / Returning Student
            </button>
          </div>
        </div>

        {form.isNewStudent ? (
          <div className="card">
            <strong>Student Information</strong>
            <div className="field-grid cols-3" style={{ marginTop: 10 }}>
              <div><label className="label">First name</label>
                <input className="input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required /></div>
              <div><label className="label">Middle name</label>
                <input className="input" value={form.middleName} onChange={(e) => setForm({ ...form, middleName: e.target.value })} /></div>
              <div><label className="label">Last name</label>
                <input className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required /></div>
            </div>
            <div className="field-grid cols-3">
              <div><label className="label">Birth date</label>
                <input className="input" type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} required /></div>
              <div>
                <label className="label">Sex</label>
                <select className="input" value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })} required>
                  <option value="">Select</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
              </div>
              <div><label className="label">LRN (if already assigned)</label>
                <input className="input" value={form.lrn} onChange={(e) => setForm({ ...form, lrn: e.target.value })} /></div>
            </div>
          </div>
        ) : (
          <div className="card">
            <strong>Search by Learner Reference Number (LRN)</strong>
            <p className="hint">Check the student ID or the Form 137 the parent brought in.</p>
            <div className="btn-row" style={{ marginBottom: 10 }}>
              <input className="input" style={{ maxWidth: 220 }} placeholder="LRN" value={lrnQuery} onChange={(e) => setLrnQuery(e.target.value)} />
              <button className="btn btn-secondary" type="button" onClick={handleLrnSearch} disabled={lrnSearching}>
                {lrnSearching ? 'Searching...' : 'Search'}
              </button>
            </div>
            {lrnResult === 'not_found' && <p style={{ color: 'var(--danger)', fontSize: 13 }}>No student found with that LRN.</p>}
            {lrnResult && lrnResult !== 'not_found' && (
              <div className="settings-row" style={{ borderTop: 'none' }}>
                <div>
                  <b>{lrnResult.last_name}, {lrnResult.first_name}{lrnResult.middle_name ? ` ${lrnResult.middle_name}` : ''}</b>
                  <div className="cell-sub">
                    {lrnResult.last_enrollment
                      ? `Currently ${lrnResult.last_enrollment.grade_level_name}${lrnResult.last_enrollment.section_name ? `, ${lrnResult.last_enrollment.section_name}` : ''} · SY ${lrnResult.last_enrollment.school_year_label}`
                      : 'No prior enrollment on record'}
                  </div>
                </div>
                <span className="pill pill-approved">Matched</span>
              </div>
            )}
          </div>
        )}

        <div className="card">
          <strong>Grade Level</strong>
          <div className="field-grid cols-2" style={{ marginTop: 10 }}>
            <div>
              <label className="label">Applying for</label>
              <select
                className="input" value={form.gradeLevelId}
                onChange={(e) => { setForm({ ...form, gradeLevelId: e.target.value, sectionId: '' }); setSections([]); }}
                required
              >
                <option value="">Select grade level</option>
                {gradeLevels.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              {loadError && <p className="field-error">{loadError}</p>}
              {!loadError && gradesLoaded && gradeLevels.length === 0 && (
                <p className="field-error">No grade levels have been set up yet. Please ask the administrator to add them.</p>
              )}
            </div>
            <div>
              <label className="label">Section (optional — can be assigned later)</label>
              <select className="input" value={form.sectionId} onChange={(e) => setForm({ ...form, sectionId: e.target.value })} disabled={!form.gradeLevelId}>
                <option value="">Not yet assigned</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="card">
          <strong>Physical Documents Received</strong>
          <p className="hint">Check off what the parent physically handed over today.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {docTypes.map((d) => (
              <label key={d.code} className="check-row">
                <input type="checkbox" checked={checkedDocs.includes(d.code)} onChange={() => toggleDoc(d.code)} />
                {d.label}{d.is_required && <span className="muted" style={{ fontSize: 11 }}> (required)</span>}
              </label>
            ))}
          </div>
        </div>

        <button className="btn btn-primary" type="submit" disabled={saving || !canSubmit} style={{ width: '100%' }}>
          {saving ? 'Submitting...' : 'Submit on Behalf of Guardian'}
        </button>
      </form>
    </div>
  );
}