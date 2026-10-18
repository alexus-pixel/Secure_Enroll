import { useEffect, useState } from 'react';
import { adminWalkIn } from '../../api/walkIn';
import {
  validateName, validateContactNumber, validateText, validateLrn, validateBirthDate, validateEmail,
  birthDateBounds, RELATIONSHIPS, NAME_MAX, ADDRESS_MAX,
} from '../../utils/validators';

const BIRTH_BOUNDS = birthDateBounds();
const digitsOnly = (v, max) => v.replace(/\D/g, '').slice(0, max);

// One rule per field, shared by the blur checks and the submit check. The
// server repeats every rule, so this is only here to give clear, early messages.
function validateField(name, form) {
  switch (name) {
    case 'guardianEmail': {
      const problem = validateEmail(form.guardianEmail);
      if (problem) return problem;
      return /@gmail\.com$/i.test(form.guardianEmail.trim()) ? '' : 'Enter a Gmail address ending in @gmail.com.';
    }
    case 'confirmEmail':
      return form.confirmEmail.trim().toLowerCase() === form.guardianEmail.trim().toLowerCase()
        ? '' : 'The two Gmail addresses do not match.';
    case 'guardianFirstName': return validateName(form.guardianFirstName, { label: 'First name' });
    case 'guardianMiddleName': return validateName(form.guardianMiddleName, { required: false, label: 'Middle name' });
    case 'guardianLastName': return validateName(form.guardianLastName, { label: 'Last name' });
    case 'guardianContactNumber': return validateContactNumber(form.guardianContactNumber);
    case 'guardianAddress': return validateText(form.guardianAddress, { label: 'Address', max: ADDRESS_MAX });
    case 'firstName': return form.isNewStudent ? validateName(form.firstName, { label: 'First name' }) : '';
    case 'middleName': return form.isNewStudent ? validateName(form.middleName, { required: false, label: 'Middle name' }) : '';
    case 'lastName': return form.isNewStudent ? validateName(form.lastName, { label: 'Last name' }) : '';
    case 'birthDate': return form.isNewStudent ? validateBirthDate(form.birthDate) : '';
    case 'sex': return form.isNewStudent && !form.sex ? 'Choose Male or Female.' : '';
    case 'lrn': return form.isNewStudent ? validateLrn(form.lrn) : '';
    case 'gradeLevelId': return form.gradeLevelId ? '' : 'Choose a grade level.';
    default: return '';
  }
}

const ALL_FIELDS = [
  'guardianEmail', 'confirmEmail', 'guardianFirstName', 'guardianMiddleName', 'guardianLastName',
  'guardianContactNumber', 'guardianAddress', 'firstName', 'middleName', 'lastName', 'birthDate',
  'sex', 'lrn', 'gradeLevelId',
];

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
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
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

  // Standard wiring for one text field: value, change (re-checks once the field
  // has been flagged), blur (checks it) and the red outline when it has a problem.
  const bind = (field) => ({
    id: `walkin_${field}`,
    className: `input${errors[field] ? ' input-error' : ''}`,
    value: form[field],
    onChange: (e) => {
      const next = { ...form, [field]: e.target.value };
      setForm(next);
      if (touched[field]) setErrors((prev) => ({ ...prev, [field]: validateField(field, next) }));
      if (field === 'guardianEmail' && touched.confirmEmail) {
        setErrors((prev) => ({ ...prev, confirmEmail: validateField('confirmEmail', next) }));
      }
    },
    onBlur: () => {
      setTouched((prev) => ({ ...prev, [field]: true }));
      setErrors((prev) => ({ ...prev, [field]: validateField(field, form) }));
    },
    'aria-invalid': errors[field] ? 'true' : undefined,
  });
  const fieldError = (field) => (errors[field] ? <p className="field-error">{errors[field]}</p> : null);

  async function handleLrnSearch(e) {
    e.preventDefault();
    setError('');
    const lrnProblem = validateLrn(lrnQuery, { required: true });
    if (lrnProblem) {
      setLrnResult(null);
      setError(lrnQuery.trim() ? lrnProblem : 'Enter an LRN to search.');
      return;
    }
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
    if (saving) return; // ignore a double click
    setError('');
    setSuccess(null);

    // Check every field at once so the staff member sees all the problems together.
    const found = {};
    ALL_FIELDS.forEach((f) => { found[f] = validateField(f, form); });
    setErrors(found);
    setTouched(Object.fromEntries(ALL_FIELDS.map((f) => [f, true])));
    const firstBad = ALL_FIELDS.find((f) => found[f]);
    if (firstBad) {
      setError('Please correct the highlighted fields and try again.');
      document.getElementById(`walkin_${firstBad}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      // Empty strings must become undefined: the server treats a
      // blank sectionId as 0 and rejects it, and a blank LRN as invalid.
      const payload = form.isNewStudent
        ? { ...form, lrn: form.lrn.trim() || undefined }
        : { ...form, isNewStudent: false, existingStudentId: form.existingStudentId };
      const result = await client.create({
        ...payload,
        guardianEmail: form.guardianEmail.trim().toLowerCase(),
        guardianMiddleName: form.guardianMiddleName.trim() || undefined,
        middleName: form.middleName.trim() || undefined,
        guardianValidIdType: form.guardianValidIdType.trim() || undefined,
        relationship: form.relationship || undefined,
        sectionId: form.sectionId || undefined,
        physicalDocTypes: checkedDocs,
      });
      setSuccess(result);
      setForm(emptyForm);
      setErrors({});
      setTouched({});
      setCheckedDocs([]);
      setLrnQuery('');
      setLrnResult(null);
    } catch (err) {
      setError(err.response?.data?.errors?.map((x) => x.message).join(' ') || err.response?.data?.message || 'Could not complete this enrollment.');
    } finally {
      setSaving(false);
    }
  }

  // A returning student must be found by LRN first; everything else is checked
  // field by field when the form is submitted.
  const canSubmit = form.isNewStudent || !!form.existingStudentId;

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

      <form onSubmit={handleSubmit} noValidate>
        <div className="card">
          <strong>Parent Account</strong>
          <p className="hint">Required. The Gmail entered here is the parent&rsquo;s login for the parent portal.</p>
          <div className="field-grid cols-2" style={{ marginTop: 10 }}>
            <div>
              <label className="label">Parent&rsquo;s Gmail</label>
              <input
                {...bind('guardianEmail')} type="email" placeholder="name@gmail.com" autoComplete="off" maxLength={254}
              />
              {fieldError('guardianEmail')}
            </div>
            <div>
              <label className="label">Confirm Gmail</label>
              <input
                {...bind('confirmEmail')} type="email" placeholder="Re-type the Gmail" autoComplete="off" maxLength={254}
              />
              {fieldError('confirmEmail')}
            </div>
          </div>
          <p className="hint">
            Double-check this with the parent. A mistyped address would link the child&rsquo;s application to the wrong person.
            If this Gmail already has a parent account, it is reused and no duplicate is created.
          </p>
          <div className="field-grid cols-3">
            <div><label className="label">First name</label>
              <input {...bind('guardianFirstName')} maxLength={NAME_MAX} />{fieldError('guardianFirstName')}</div>
            <div><label className="label">Middle name</label>
              <input {...bind('guardianMiddleName')} maxLength={NAME_MAX} />{fieldError('guardianMiddleName')}</div>
            <div><label className="label">Last name</label>
              <input {...bind('guardianLastName')} maxLength={NAME_MAX} />{fieldError('guardianLastName')}</div>
          </div>
          <div className="field-grid cols-3">
            <div><label className="label">Contact number</label>
              <input {...bind('guardianContactNumber')} placeholder="09171234567" inputMode="numeric" maxLength={11} />
              {fieldError('guardianContactNumber')}</div>
            <div><label className="label">Relationship to student</label>
              <select className="input" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })}>
                <option value="">Select (recorded as Guardian if blank)</option>
                {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select></div>
            <div><label className="label">Address</label>
              <input {...bind('guardianAddress')} maxLength={ADDRESS_MAX} />{fieldError('guardianAddress')}</div>
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
                <input {...bind('firstName')} maxLength={NAME_MAX} />{fieldError('firstName')}</div>
              <div><label className="label">Middle name</label>
                <input {...bind('middleName')} maxLength={NAME_MAX} />{fieldError('middleName')}</div>
              <div><label className="label">Last name</label>
                <input {...bind('lastName')} maxLength={NAME_MAX} />{fieldError('lastName')}</div>
            </div>
            <div className="field-grid cols-3">
              <div><label className="label">Birth date</label>
                <input {...bind('birthDate')} type="date" min={BIRTH_BOUNDS.min} max={BIRTH_BOUNDS.max} />
                {fieldError('birthDate')}</div>
              <div>
                <label className="label">Sex</label>
                <select {...bind('sex')}>
                  <option value="">Select</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
                {fieldError('sex')}
              </div>
              <div><label className="label">LRN (if already assigned)</label>
                <input {...bind('lrn')} inputMode="numeric" maxLength={12} placeholder="12 digits"
                  onChange={(e) => bind('lrn').onChange({ target: { value: digitsOnly(e.target.value, 12) } })} />
                {fieldError('lrn')}</div>
            </div>
          </div>
        ) : (
          <div className="card">
            <strong>Search by Learner Reference Number (LRN)</strong>
            <p className="hint">Check the student ID or the Form 137 the parent brought in.</p>
            <div className="btn-row" style={{ marginBottom: 10 }}>
              <input className="input" style={{ maxWidth: 220 }} placeholder="LRN" value={lrnQuery} inputMode="numeric" maxLength={12}
                onChange={(e) => setLrnQuery(digitsOnly(e.target.value, 12))} />
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
                {...bind('gradeLevelId')}
                onChange={(e) => {
                  setForm({ ...form, gradeLevelId: e.target.value, sectionId: '' });
                  setSections([]);
                  setErrors((prev) => ({ ...prev, gradeLevelId: e.target.value ? '' : prev.gradeLevelId }));
                }}
              >
                <option value="">Select grade level</option>
                {gradeLevels.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              {fieldError('gradeLevelId')}
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