import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import AppNav from '../components/AppNav';
import { useScrollToError } from '../hooks/useScrollToError';
import {
  validateName, validateContactNumber, validateText, validateLrn, validateBirthDate, validateFile,
  birthDateBounds, RELATIONSHIPS, NAME_MAX, ADDRESS_MAX,
} from '../utils/validators';

const GRADE_LEVELS = [
  { id: 1, name: 'Kinder' }, { id: 2, name: 'Grade 1' }, { id: 3, name: 'Grade 2' },
  { id: 4, name: 'Grade 3' }, { id: 5, name: 'Grade 4' }, { id: 6, name: 'Grade 5' }, { id: 7, name: 'Grade 6' },
];

const DOC_LABELS = {
  birth_certificate: 'Birth Certificate',
  form_138: 'Form 138 / Report Card',
  good_moral: 'Certificate of Good Moral Character',
};

// The date picker only offers real school-age birth dates (3 to 18 years
// old, never in the future); the server checks the same rule.
const BIRTH_BOUNDS = birthDateBounds();

const FRESH_FIELDS = [
  'firstName', 'middleName', 'lastName', 'birthDate', 'lrn',
  'guardianFirstName', 'guardianLastName', 'contactNumber', 'address',
];

function validateField(name, form) {
  switch (name) {
    case 'firstName': return validateName(form.firstName, { label: 'First name' });
    case 'middleName': return validateName(form.middleName, { required: false, label: 'Middle name' });
    case 'lastName': return validateName(form.lastName, { label: 'Last name' });
    case 'birthDate': return validateBirthDate(form.birthDate);
    case 'lrn': return validateLrn(form.lrn, { required: form.gradeLevelId !== '1' });
    case 'guardianFirstName': return validateName(form.guardianFirstName, { label: 'First name' });
    case 'guardianLastName': return validateName(form.guardianLastName, { label: 'Last name' });
    case 'contactNumber': return validateContactNumber(form.contactNumber);
    case 'address': return validateText(form.address, { label: 'Address', max: ADDRESS_MAX });
    default: return '';
  }
}

// Uploads the chosen files one by one. A file that fails does not stop the
// others; the names of the failures come back so the parent can retry them.
async function uploadDocuments(applicationId, files) {
  const failed = [];
  for (const [docType, file] of Object.entries(files)) {
    if (!file) continue;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('docType', docType);
    try {
      await api.post(`/applications/${applicationId}/documents`, fd);
    } catch (err) {
      failed.push(`${DOC_LABELS[docType]} (${err.response?.data?.message || 'upload failed'})`);
    }
  }
  return failed;
}

export default function NewApplication() {
  // Three steps: choose (New vs. Old student, the entry point), then
  // either search (LRN lookup) or fresh (the full form).
  const [mode, setMode] = useState('choose');
  const [studentType, setStudentType] = useState('new');
  const navigate = useNavigate();

  // ---------------- Find Returning Student ----------------
  const [lrn, setLrn] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  useScrollToError(searchError);
  const [result, setResult] = useState(null);
  const [promoFiles, setPromoFiles] = useState({});
  const [promoFileErrors, setPromoFileErrors] = useState({});
  const [promoting, setPromoting] = useState(false);
  // Set when the application was saved but some documents failed to upload.
  const [partial, setPartial] = useState(null);

  async function handleSearch(e) {
    e.preventDefault();
    setSearchError('');
    setResult(null);
    const lrnProblem = validateLrn(lrn, { required: true });
    if (lrnProblem) {
      setSearchError(lrn.trim() ? lrnProblem : 'Enter an LRN to search.');
      return;
    }
    setSearching(true);
    try {
      const { data } = await api.get('/students/lookup', { params: { lrn: lrn.trim() } });
      setResult(data);
      setPromoFiles({});
      setPromoFileErrors({});
      setPartial(null);
    } catch (err) {
      setSearchError(err.response?.data?.message || 'Search failed.');
    } finally {
      setSearching(false);
    }
  }

  // A wrong file type or size is reported straight away, next to the field.
  const pickPromoFile = (docType) => (e) => {
    const file = e.target.files[0] || null;
    const problem = validateFile(file, { label: DOC_LABELS[docType] });
    setPromoFileErrors({ ...promoFileErrors, [docType]: problem });
    setPromoFiles({ ...promoFiles, [docType]: problem ? null : file });
    if (problem) e.target.value = '';
  };

  async function handlePromote() {
    if (promoting) return; // ignore a double click
    setSearchError('');
    setPartial(null);
    setPromoting(true);
    try {
      const { data } = await api.post('/applications/promote', {
        studentId: result.student.id, gradeLevelId: result.nextGradeLevelId,
      });
      const failed = await uploadDocuments(data.id, promoFiles);
      if (failed.length) {
        setPartial({ id: data.id, failed });
        return;
      }
      navigate('/dashboard');
    } catch (err) {
      setSearchError(err.response?.data?.message || 'Submission failed.');
    } finally {
      setPromoting(false);
    }
  }

  // ---------------- Fresh application ----------------
  const [form, setForm] = useState({
    firstName: '', middleName: '', lastName: '', birthDate: '', sex: 'F', lrn: '',
    guardianFirstName: '', guardianMiddleName: '', guardianLastName: '',
    relationship: 'Mother', contactNumber: '', address: '',
    gradeLevelId: '1',
  });
  const [error, setError] = useState('');
  useScrollToError(error);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [files, setFiles] = useState({ birth_certificate: null, form_138: null, good_moral: null });
  const [fileErrors, setFileErrors] = useState({});

  const update = (field) => (e) => {
    const next = { ...form, [field]: e.target.value };
    setForm(next);
    // Once a field has been flagged, re-check it as the parent retypes it so
    // the message clears right away.
    if (touched[field]) setErrors((prev) => ({ ...prev, [field]: validateField(field, next) }));
    // The LRN rule depends on the grade level (optional only for Kinder).
    if (field === 'gradeLevelId' && touched.lrn) {
      setErrors((prev) => ({ ...prev, lrn: validateField('lrn', next) }));
    }
  };
  // The LRN box accepts digits only, never more than 12.
  const updateLrn = (e) => update('lrn')({ target: { value: e.target.value.replace(/\D/g, '').slice(0, 12) } });
  const handleBlur = (field) => () => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors((prev) => ({ ...prev, [field]: validateField(field, form) }));
  };
  const inputProps = (field) => ({
    id: field,
    className: `input${errors[field] ? ' input-error' : ''}`,
    value: form[field],
    onChange: update(field),
    onBlur: handleBlur(field),
    'aria-invalid': errors[field] ? 'true' : undefined,
  });
  const fieldError = (field) => (errors[field] ? <p className="field-error">{errors[field]}</p> : null);

  const pickFile = (docType) => (e) => {
    const file = e.target.files[0] || null;
    const problem = validateFile(file, { label: DOC_LABELS[docType] });
    setFileErrors({ ...fileErrors, [docType]: problem });
    setFiles({ ...files, [docType]: problem ? null : file });
    if (problem) e.target.value = '';
  };
  // Set when the application was saved but some documents failed to upload.
  const [freshPartial, setFreshPartial] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return; // ignore a double click
    setError('');

    // Check every field at once so the parent sees all the problems together.
    // LRN is only genuinely optional for Kinder -- reaching Grade 1 or above
    // means the student has been enrolled somewhere in DepEd's system before,
    // so they should already have one.
    const found = {};
    FRESH_FIELDS.forEach((f) => { found[f] = validateField(f, form); });
    setErrors(found);
    setTouched(Object.fromEntries(FRESH_FIELDS.map((f) => [f, true])));
    const firstBad = FRESH_FIELDS.find((f) => found[f]);
    if (firstBad) {
      setError('Please correct the highlighted fields and try again.');
      document.getElementById(firstBad)?.focus({ preventScroll: true });
      return;
    }
    if (Object.values(fileErrors).some(Boolean)) {
      setError('Please replace the file that cannot be uploaded.');
      return;
    }

    setSubmitting(true);
    try {
      const trim = (v) => v.trim();
      const { data } = await api.post('/applications', {
        ...form,
        firstName: trim(form.firstName), middleName: trim(form.middleName), lastName: trim(form.lastName),
        guardianFirstName: trim(form.guardianFirstName), guardianLastName: trim(form.guardianLastName),
        contactNumber: trim(form.contactNumber), address: trim(form.address),
        lrn: trim(form.lrn) || undefined,
      });
      const failed = await uploadDocuments(data.id, files);
      if (failed.length) {
        setFreshPartial({ id: data.id, failed });
        return;
      }
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Submission failed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (mode === 'search') {
    return (
      <>
        <AppNav crumb="New Enrollment Application" />
        <div className="container container-narrow">
          <button type="button" className="back-link" onClick={() => setMode('choose')}>&larr; Go Back</button>
          <div className="page-head">
            <div>
              <h1>Find Returning Student</h1>
              <p>School Year 2026&ndash;2027</p>
            </div>
          </div>

          <form className="card" onSubmit={handleSearch}>
            <h3>Search by Learner Reference Number (LRN)</h3>
            <p className="hint">Check the student ID or the Form 137 of the student.</p>
            <div className="field" style={{ maxWidth: 360 }}>
              <label className="label" htmlFor="searchLrn">LRN</label>
              <input id="searchLrn" className="input" value={lrn} inputMode="numeric" maxLength={12}
                onChange={(e) => setLrn(e.target.value.replace(/\D/g, '').slice(0, 12))}
                placeholder="e.g. 136482910573" />
            </div>
            {searchError && <div className="alert alert-error">{searchError}</div>}
            <button className="btn btn-secondary" type="submit" disabled={searching}>
              {searching ? 'Searching\u2026' : 'Search'}
            </button>
          </form>

          {result && !result.found && (
            <div className="card"><p className="muted">No record found for that LRN.</p></div>
          )}

          {result && result.found && !result.promotable && (
            <div className="card">
              <p className="section-label">Record found</p>
              <p>{result.message}</p>
            </div>
          )}

          {result && result.found && result.promotable && (
            <>
              <div className="card">
                <p className="section-label">Record found</p>
                <div className="doc-row doc-row-done">
                  <div>
                    <div className="doc-name">{result.student.firstName} {result.student.lastName}</div>
                    <div className="doc-sub">Currently {result.currentGrade} &middot; SY {result.currentSchoolYear}</div>
                  </div>
                </div>
                <p className="hint" style={{ marginTop: 12 }}>
                  Promoting to <b>{result.nextGradeLevelName}</b>. Guardian and student details will be
                  carried over &mdash; only the updated documents are needed below.
                </p>
              </div>

              <div className="card">
                <p className="section-label">
                  {result.documentsNeeded.length > 0
                    ? `Only ${result.documentsNeeded.map((t) => DOC_LABELS[t]).join(' and ')} required for promotion.`
                    : 'All documents already on file.'}
                  {result.documentsOnFile.length > 0
                    && ` ${result.documentsOnFile.map((t) => DOC_LABELS[t]).join(' and ')} already on file.`}
                </p>
                {result.documentsNeeded.map((docType) => (
                  <div className="field" key={docType}>
                    <label className="label">{DOC_LABELS[docType]}</label>
                    <input className={`input${promoFileErrors[docType] ? ' input-error' : ''}`} type="file"
                      accept=".pdf,.jpg,.jpeg,.png" onChange={pickPromoFile(docType)} />
                    {promoFileErrors[docType] && <p className="field-error">{promoFileErrors[docType]}</p>}
                  </div>
                ))}
                {result.documentsOnFile.map((docType) => (
                  <div className="doc-row doc-row-done" key={docType}>
                    <div>
                      <div className="doc-name">{DOC_LABELS[docType]}</div>
                      <div className="doc-sub">Already on file.</div>
                    </div>
                  </div>
                ))}
              </div>

              {partial && (
                <div className="alert alert-error" role="alert">
                  Your application was submitted, but these documents could not be uploaded: {partial.failed.join('; ')}.
                  {' '}You can upload them again from the application page.
                  {' '}<button type="button" className="btn btn-secondary" onClick={() => navigate(`/applications/${partial.id}`)}>
                    Open application
                  </button>
                </div>
              )}
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={handlePromote}
                disabled={promoting || Boolean(partial) || Object.values(promoFileErrors).some(Boolean)}>
                {promoting ? 'Submitting\u2026' : 'Submit Application'}
              </button>
            </>
          )}
        </div>
      </>
    );
  }

  if (mode === 'fresh') {
    return (
      <>
        <AppNav crumb="New Enrollment Application" />
        <div className="container container-narrow">
          <button type="button" className="back-link" onClick={() => setMode('choose')}>&larr; Go Back</button>
          <div className="page-head">
            <div>
              <h1>New Enrollment Application</h1>
              <p>School Year 2026&ndash;2027</p>
            </div>
          </div>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {freshPartial && (
            <div className="alert alert-error" role="alert">
              Your application was submitted, but these documents could not be uploaded: {freshPartial.failed.join('; ')}.
              {' '}You can upload them again from the application page.
              {' '}<button type="button" className="btn btn-secondary" onClick={() => navigate(`/applications/${freshPartial.id}`)}>
                Open application
              </button>
            </div>
          )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="card">
            <h3>Student Information</h3>
            <div className="field-grid cols-3">
              <div><label className="label" htmlFor="firstName">First name</label>
                <input {...inputProps('firstName')} maxLength={NAME_MAX} autoComplete="off" />
                {fieldError('firstName')}</div>
              <div><label className="label" htmlFor="middleName">Middle name</label>
                <input {...inputProps('middleName')} maxLength={NAME_MAX} autoComplete="off" />
                {fieldError('middleName')}</div>
              <div><label className="label" htmlFor="lastName">Last name</label>
                <input {...inputProps('lastName')} maxLength={NAME_MAX} autoComplete="off" />
                {fieldError('lastName')}</div>
            </div>
            <div className="field-grid cols-2">
              <div><label className="label" htmlFor="birthDate">Birth date</label>
                <input {...inputProps('birthDate')} type="date" min={BIRTH_BOUNDS.min} max={BIRTH_BOUNDS.max} />
                {fieldError('birthDate')}</div>
              <div><label className="label" htmlFor="sex">Sex</label>
                <select id="sex" className="input" value={form.sex} onChange={update('sex')}>
                  <option value="F">Female</option><option value="M">Male</option>
                </select></div>
            </div>
            <div className="field">
              <label className="label" htmlFor="lrn">
                Learner Reference Number (LRN){form.gradeLevelId === '1' ? ' \u2014 if already assigned' : ''}
              </label>
              <input {...inputProps('lrn')} onChange={updateLrn} inputMode="numeric" autoComplete="off"
                placeholder="12-digit LRN" maxLength={12} />
              {errors.lrn
                ? <p className="field-error">{errors.lrn}</p>
                : <p className="hint hint-spaced">
                    {form.gradeLevelId === '1'
                      ? 'Leave this blank for a first-time Kinder entrant \u2014 the school assigns one.'
                      : 'Required \u2014 a student entering Grade 1 or above should already have an LRN from a previous enrollment.'}
                  </p>}
            </div>
          </div>

          <div className="card">
            <h3>Guardian Information</h3>
            <div className="field-grid cols-2">
              <div><label className="label" htmlFor="guardianFirstName">Your first name</label>
                <input {...inputProps('guardianFirstName')} maxLength={NAME_MAX} autoComplete="given-name" />
                {fieldError('guardianFirstName')}</div>
              <div><label className="label" htmlFor="guardianLastName">Your last name</label>
                <input {...inputProps('guardianLastName')} maxLength={NAME_MAX} autoComplete="family-name" />
                {fieldError('guardianLastName')}</div>
            </div>
            <div className="field-grid cols-2">
              <div><label className="label" htmlFor="relationship">Relationship to student</label>
                <select id="relationship" className="input" value={form.relationship} onChange={update('relationship')}>
                  {RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}
                </select></div>
              <div><label className="label" htmlFor="contactNumber">Contact number</label>
                <input {...inputProps('contactNumber')} inputMode="numeric" maxLength={11} autoComplete="tel"
                  placeholder="09171234567" />
                {fieldError('contactNumber')}</div>
            </div>
            <div className="field">
              <label className="label" htmlFor="address">Address</label>
              <input {...inputProps('address')} maxLength={ADDRESS_MAX} autoComplete="street-address" />
              {fieldError('address')}
            </div>
          </div>

          <div className="card">
            <h3>Grade Level</h3>
            <div className="field">
              <label className="label" htmlFor="gradeLevelId">Applying for</label>
              <select id="gradeLevelId" className="input" value={form.gradeLevelId} onChange={update('gradeLevelId')}>
                {GRADE_LEVELS.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          </div>

          <div className="card">
            <h3>Required Documents</h3>
            <p className="hint">PDF, JPG or PNG. Maximum 5MB each.</p>
            {[['birth_certificate', 'Birth Certificate'], ['form_138', 'Form 138 / Report Card'],
              ['good_moral', 'Certificate of Good Moral Character']].map(([docType, label]) => (
              <div className="field" key={docType}>
                <label className="label" htmlFor={`file_${docType}`}>{label}</label>
                <input id={`file_${docType}`} className={`input${fileErrors[docType] ? ' input-error' : ''}`} type="file"
                  accept=".pdf,.jpg,.jpeg,.png" onChange={pickFile(docType)} />
                {fileErrors[docType] && <p className="field-error">{fileErrors[docType]}</p>}
              </div>
            ))}
          </div>

          <div className="btn-row">
            <button className="btn btn-primary" type="submit" disabled={submitting || Boolean(freshPartial)}>
              {submitting ? 'Submitting\u2026' : 'Submit Application'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/dashboard')}>Cancel</button>
          </div>
        </form>
        </div>
      </>
    );
  }

  // ---------------- New / Old student choice (entry point) ----------------
  return (
    <>
      <AppNav crumb="New Enrollment Application" />
      <div className="container container-narrow">
        <button type="button" className="back-link" onClick={() => navigate('/dashboard')}>&larr; Go Back</button>
        <div className="page-head">
          <div>
            <h1>New Enrollment Application</h1>
            <p>School Year 2026&ndash;2027</p>
          </div>
        </div>

        <div className="card">
          <h3>Is this student NEW or ALREADY ENROLLED before?</h3>
          <p className="hint">Returning students (e.g. moving up from Grade 5 to Grade 6) can skip re-entering their information.</p>

          <div className="choice-grid">
            <button type="button" className={`choice-card${studentType === 'new' ? ' selected' : ''}`}
              onClick={() => setStudentType('new')}>
              {studentType === 'new' && <span className="choice-selected-label">SELECTED</span>}
              <span className="choice-title">New Student</span>
              <span className="choice-desc">
                First time enrolling at Caloocan City Elementary School. Fill out full student and guardian information.
              </span>
            </button>
            <button type="button" className={`choice-card${studentType === 'old' ? ' selected' : ''}`}
              onClick={() => setStudentType('old')}>
              {studentType === 'old' && <span className="choice-selected-label">SELECTED</span>}
              <span className="choice-title">Old Student</span>
              <span className="choice-desc">
                Already has a Learner Reference Number (LRN) on file. Look up their existing record instead.
              </span>
            </button>
          </div>
        </div>

        <button className="btn btn-primary" onClick={() => setMode(studentType === 'old' ? 'search' : 'fresh')}>
          Continue
        </button>
      </div>
    </>
  );
}
