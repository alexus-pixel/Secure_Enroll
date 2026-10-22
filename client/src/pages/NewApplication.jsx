import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import AppNav from '../components/AppNav';
import EnrollmentGate from '../components/EnrollmentGate';
import useEnrollment from '../hooks/useEnrollment';
import { useScrollToError } from '../hooks/useScrollToError';
import MiddleNameField from '../components/MiddleNameField';
import { sampleFor } from '../utils/samplePlaceholders';
import {
  validateName, validateContactNumber, validateAddress, validateLrn, validateBirthDate, validateFile,
  validateBirthDateForGrade, validateMiddleName, FILE_ACCEPT,
  birthDateBounds, sanitizePhone, RELATIONSHIPS, NAME_MAX, ADDRESS_MAX,
} from '../utils/validators';

// Shown only until the school's grade list loads from the server.
const FALLBACK_GRADES = [
  { id: 1, name: 'Kinder' }, { id: 2, name: 'Grade 1' }, { id: 3, name: 'Grade 2' },
  { id: 4, name: 'Grade 3' }, { id: 5, name: 'Grade 4' }, { id: 6, name: 'Grade 5' }, { id: 7, name: 'Grade 6' },
];

// "12 slots left", "1 slot left" or "full" for a grade that has sections set up.
function slotsText(g) {
  if (!g || !g.totalSlots) return '';
  if (g.slotsLeft <= 0) return 'full';
  return `${g.slotsLeft} ${g.slotsLeft === 1 ? 'slot' : 'slots'} left`;
}

// The picker offers a complete list of years and refuses only a date in the
// future. There is no age limit for any grade level.
const BIRTH_BOUNDS = birthDateBounds();

const FRESH_FIELDS = [
  'firstName', 'middleName', 'lastName', 'birthDate',
  'guardianFirstName', 'guardianMiddleName', 'guardianLastName',
  'relationshipOther', 'contactNumber', 'address',
];

function validateField(name, form, context = {}) {
  switch (name) {
    case 'firstName': return validateName(form.firstName, { label: 'First name' });
    case 'middleName': return validateMiddleName(form.middleName, { none: form.noMiddleName });
    case 'lastName': return validateName(form.lastName, { label: 'Last name' });
    case 'birthDate':
      return context.grade
        ? validateBirthDateForGrade(form.birthDate, context.grade, context.yearStartsOn)
        : validateBirthDate(form.birthDate);
    case 'guardianFirstName': return validateName(form.guardianFirstName, { label: 'First name' });
    case 'guardianMiddleName':
      return validateMiddleName(form.guardianMiddleName, { none: form.guardianNoMiddleName });
    case 'guardianLastName': return validateName(form.guardianLastName, { label: 'Last name' });
    case 'relationshipOther':
      return form.relationship === 'Other'
        ? validateName(form.relationshipOther, { label: 'Relationship' })
        : '';
    case 'contactNumber': return validateContactNumber(form.contactNumber);
    case 'address': return validateAddress(form.address);
    default: return '';
  }
}

// Uploads the chosen files one by one. A file that fails does not stop the
// others; the names of the failures come back so the parent can retry them.
async function uploadDocuments(applicationId, files, labelOf) {
  const failed = [];
  for (const [docType, file] of Object.entries(files)) {
    if (!file) continue;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('docType', docType);
    try {
      await api.post(`/applications/${applicationId}/documents`, fd);
    } catch (err) {
      failed.push(`${labelOf(docType)} (${err.response?.data?.message || 'upload failed'})`);
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

  // The document checklist and the grades (with slots left) come from the
  // administrator's settings, so changing them there changes this form.
  const enrollment = useEnrollment();
  const docTypes = enrollment.documents;
  const docLabels = Object.fromEntries(docTypes.map((d) => [d.code, d.label]));
  const labelOf = (code) => docLabels[code] || code.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const grades = enrollment.grades.length ? enrollment.grades : FALLBACK_GRADES;
  // Age for a grade level is counted on the first day of classes.
  const yearStartsOn = enrollment.schoolYear?.classesStartOn || enrollment.enrollment?.opensOn || '';

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
    const problem = validateFile(file, { label: labelOf(docType) });
    setPromoFileErrors({ ...promoFileErrors, [docType]: problem });
    setPromoFiles({ ...promoFiles, [docType]: problem ? null : file });
    if (problem) e.target.value = '';
  };

  async function handlePromote() {
    if (promoting) return; // ignore a double click
    setSearchError('');
    const stillNeeded = (result?.documentsNeeded || []).filter((code) => !promoFiles[code]);
    if (stillNeeded.length) {
      setSearchError(`Please attach ${stillNeeded.map((c) => labelOf(c)).join(', ')}. Every required document has to be in hand before you can enroll.`);
      return;
    }
    setPartial(null);
    setPromoting(true);
    try {
      const { data } = await api.post('/applications/promote', {
        studentId: result.student.id, gradeLevelId: result.nextGradeLevelId,
        providedDocuments: [
          ...result.documentsOnFile,
          ...Object.keys(promoFiles).filter((code) => promoFiles[code]),
        ],
      });
      const failed = await uploadDocuments(data.id, promoFiles, labelOf);
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
  const { user } = useAuth();
  const [form, setForm] = useState({
    firstName: '', middleName: '', noMiddleName: false, lastName: '', birthDate: '', sex: 'F',
    guardianFirstName: user?.firstName || '', guardianMiddleName: user?.middleName || '',
    guardianNoMiddleName: false, guardianLastName: user?.lastName || '',
    relationship: 'Mother', relationshipOther: '', contactNumber: '', address: '',
    gradeLevelId: '1',
  });
  // The guardian is usually the signed-in parent, so their name is filled in
  // from the account (as soon as it has loaded, and only while the fields are
  // still empty). It can be edited if the guardian is someone else; that never
  // changes the name on the account itself.
  useEffect(() => {
    if (user?.firstName && user?.lastName) {
      setForm((f) => (f.guardianFirstName || f.guardianLastName ? f : {
        ...f, guardianFirstName: user.firstName, guardianMiddleName: user.middleName || '', guardianLastName: user.lastName,
      }));
    }
  }, [user?.firstName, user?.middleName, user?.lastName]);
  const [error, setError] = useState('');
  useScrollToError(error);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [files, setFiles] = useState({});
  const [fileErrors, setFileErrors] = useState({});

  // The grade level decides the age window, so it is re-checked whenever the
  // grade changes. (A new learner's LRN is entered by the registrar, not here.)
  const chosenGrade = grades.find((g) => String(g.id) === String(form.gradeLevelId)) || null;
  const ageContext = {
    grade: chosenGrade && chosenGrade.sortOrder !== undefined
      ? { sortOrder: chosenGrade.sortOrder, name: chosenGrade.name } : null,
    yearStartsOn,
  };
  const checkField = (field, next) => validateField(field, next, ageContext);
  const update = (field) => (e) => {
    const next = { ...form, [field]: e.target.value };
    setForm(next);
    // Warn as the parent types, but do not say "this is required" about a
    // field they have not finished with yet.
    const problem = checkField(field, next);
    const stillEmpty = !String(next[field] || '').trim();
    setErrors((prev) => ({ ...prev, [field]: stillEmpty && !touched[field] ? '' : problem }));
    if (field === 'gradeLevelId') {
      // Both of these depend on which grade was just chosen, and `ageContext`
      // still describes the one before it, so the new grade is read from the
      // value in hand rather than from the previous render.
      const picked = grades.find((x) => String(x.id) === String(next.gradeLevelId));
      const nextContext = {
        ...ageContext,
        grade: picked && picked.sortOrder !== undefined
          ? { sortOrder: picked.sortOrder, name: picked.name } : null,
      };
      setErrors((prev) => ({
        ...prev,
        birthDate: next.birthDate ? validateField('birthDate', next, nextContext) : prev.birthDate,
      }));
    }
  };
  const updatePhone = (e) => update('contactNumber')({ target: { value: sanitizePhone(e.target.value) } });
  // Ticking "No middle name" clears the box and settles the field.
  const toggleNoMiddle = (key, nameKey) => (checked) => {
    const next = { ...form, [key]: checked, ...(checked ? { [nameKey]: '' } : {}) };
    setForm(next);
    setErrors((prev) => ({ ...prev, [nameKey]: validateField(nameKey, next, ageContext) }));
  };
  const handleBlur = (field) => () => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors((prev) => ({ ...prev, [field]: checkField(field, form) }));
  };
  const inputProps = (field) => ({
    id: field,
    className: `input${errors[field] ? ' input-error' : ''}`,
    value: form[field],
    onChange: update(field),
    onBlur: handleBlur(field),
    // An example of the format, while the box is empty. A placeholder written
    // on the box itself overrides this one, since it comes after the spread.
    placeholder: sampleFor(field),
    'aria-invalid': errors[field] ? 'true' : undefined,
  });
  const fieldError = (field) => (errors[field] ? <p className="field-error">{errors[field]}</p> : null);

  // A learner's name has to be unique across the school, so the form says so
  // while it is being typed rather than only when the server refuses it.
  const [nameTaken, setNameTaken] = useState(null);
  const nameKey = `${form.firstName.trim().toLowerCase()}|${form.middleName.trim().toLowerCase()}|${form.lastName.trim().toLowerCase()}`;
  useEffect(() => {
    const [first, , last] = nameKey.split('|');
    if (!first || !last) { setNameTaken(null); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      api.get('/students/name-taken', {
        params: {
          firstName: form.firstName.trim(),
          middleName: form.middleName.trim() || undefined,
          lastName: form.lastName.trim(),
        },
      })
        .then(({ data }) => { if (alive) setNameTaken(data.taken ? data : null); })
        .catch(() => { if (alive) setNameTaken(null); });
    }, 500);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameKey]);

  // Required documents that have no file chosen yet. The form cannot be
  // submitted while this list has anything in it (the server repeats the rule).
  const missingDocs = docTypes.filter((d) => !files[d.code]).map((d) => ({ code: d.code, label: d.label }));

  const pickFile = (docType) => (e) => {
    const file = e.target.files[0] || null;
    const problem = validateFile(file, { label: labelOf(docType) });
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
    const found = {};
    FRESH_FIELDS.forEach((f) => { found[f] = checkField(f, form); });
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
    // Nothing is submitted with a requirement missing.
    if (missingDocs.length) {
      setError(`Please attach ${missingDocs.map((d) => d.label).join(', ')}. Every required document has to be in hand before you can enroll.`);
      document.getElementById(`file_${missingDocs[0].code}`)?.focus({ preventScroll: true });
      return;
    }

    setSubmitting(true);
    try {
      const trim = (v) => v.trim();
      const { data } = await api.post('/applications', {
        ...form,
        providedDocuments: Object.keys(files).filter((code) => files[code]),
        firstName: trim(form.firstName),
        middleName: form.noMiddleName ? '' : trim(form.middleName),
        noMiddleName: form.noMiddleName,
        lastName: trim(form.lastName),
        guardianFirstName: trim(form.guardianFirstName),
        guardianMiddleName: form.guardianNoMiddleName ? '' : trim(form.guardianMiddleName),
        guardianNoMiddleName: form.guardianNoMiddleName,
        guardianLastName: trim(form.guardianLastName),
        relationship: form.relationship,
        relationshipOther: form.relationship === 'Other' ? trim(form.relationshipOther) : undefined,
        contactNumber: trim(form.contactNumber),
        address: trim(form.address).replace(/\s+/g, ' '),
      });
      const failed = await uploadDocuments(data.id, files, labelOf);
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
              <p>{enrollment.year ? `School Year ${enrollment.year}` : ''}</p>
            </div>
          </div>
<EnrollmentGate closed={enrollment.isClosed} title={enrollment.title} message={enrollment.message}>

          <form className="card" onSubmit={handleSearch}>
            <h3>Search by Learner Reference Number (LRN)</h3>
            <p className="hint">Check the student ID or the Form 137 of the student.</p>
            <div className="field" style={{ maxWidth: 360 }}>
              <label className="label" htmlFor="searchLrn">LRN</label>
              <input id="searchLrn" className="input" value={lrn} inputMode="numeric" maxLength={12}
                onChange={(e) => setLrn(e.target.value.replace(/\D/g, '').slice(0, 12))}
                placeholder="1234xxxxxxxx" />
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
                    ? 'Documents for promotion'
                    : 'All documents already on file.'}
                  {result.documentsOnFile.length > 0
                    && ` ${result.documentsOnFile.map((t) => labelOf(t)).join(' and ')} already on file.`}
                </p>
                {result.documentsNeeded.map((docType) => (
                  <div className="field" key={docType}>
                    <label className="label">{labelOf(docType)}</label>
                    <input className={`input${promoFileErrors[docType] ? ' input-error' : ''}`} type="file"
                      accept={FILE_ACCEPT} onChange={pickPromoFile(docType)} />
                    {promoFileErrors[docType] && <p className="field-error">{promoFileErrors[docType]}</p>}
                  </div>
                ))}
                {result.documentsOnFile.map((docType) => (
                  <div className="doc-row doc-row-done" key={docType}>
                    <div>
                      <div className="doc-name">{labelOf(docType)}</div>
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
        </EnrollmentGate>
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
              <p>{enrollment.year ? `School Year ${enrollment.year}` : ''}</p>
            </div>
          </div>
<EnrollmentGate closed={enrollment.isClosed} title={enrollment.title} message={enrollment.message}>
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
              <MiddleNameField
                id="middleName" value={form.middleName} none={form.noMiddleName}
                error={errors.middleName} onChange={update('middleName')} onBlur={handleBlur('middleName')}
                onToggleNone={toggleNoMiddle('noMiddleName', 'middleName')}
              />
              <div><label className="label" htmlFor="lastName">Last name</label>
                <input {...inputProps('lastName')} maxLength={NAME_MAX} autoComplete="off" />
                {fieldError('lastName')}</div>
            </div>
            {nameTaken && (
              <div className="alert alert-error" role="alert">
                <b>That name is already taken.</b>
                <div style={{ marginTop: 4 }}>{nameTaken.message}</div>
              </div>
            )}

            <div className="field-grid cols-2">
              <div><label className="label" htmlFor="birthDate">Birth date</label>
                <input {...inputProps('birthDate')} type="date" max={BIRTH_BOUNDS.max} />
                {fieldError('birthDate')}</div>
              <div><label className="label" htmlFor="sex">Sex</label>
                <select id="sex" className="input" value={form.sex} onChange={update('sex')}>
                  <option value="F">Female</option><option value="M">Male</option>
                </select></div>
            </div>
            <p className="hint hint-spaced">
              You do not need to enter a Learner Reference Number (LRN). The school registrar records it
              from your child&rsquo;s documents during enrollment.
            </p>
          </div>

          <div className="card">
            <h3>Guardian Information</h3>
            <div className="field-grid cols-3">
              <div><label className="label" htmlFor="guardianFirstName">Your first name</label>
                <input {...inputProps('guardianFirstName')} maxLength={NAME_MAX} autoComplete="given-name" />
                {fieldError('guardianFirstName')}</div>
              <MiddleNameField
                id="guardianMiddleName" label="Your middle name (optional)"
                value={form.guardianMiddleName} none={form.guardianNoMiddleName}
                error={errors.guardianMiddleName} onChange={update('guardianMiddleName')}
                onBlur={handleBlur('guardianMiddleName')} autoComplete="additional-name"
                onToggleNone={toggleNoMiddle('guardianNoMiddleName', 'guardianMiddleName')}
              />
              <div><label className="label" htmlFor="guardianLastName">Your last name</label>
                <input {...inputProps('guardianLastName')} maxLength={NAME_MAX} autoComplete="family-name" />
                {fieldError('guardianLastName')}</div>
            </div>
            <p className="hint">Filled in from your account. Change it only if the guardian is someone else.</p>
            <div className="field-grid cols-2">
              <div><label className="label" htmlFor="relationship">Relationship to student</label>
                <select id="relationship" className="input" value={form.relationship} onChange={update('relationship')}>
                  {RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}
                </select></div>
              <div><label className="label" htmlFor="contactNumber">Contact number</label>
                <input {...inputProps('contactNumber')} onChange={updatePhone} inputMode="tel" maxLength={13} autoComplete="tel"
                />
                {errors.contactNumber ? fieldError('contactNumber')
                  : <p className="hint">09XXXXXXXXX, or +639XXXXXXXXX</p>}</div>
            </div>
            {form.relationship === 'Other' && (
              <div className="field">
                <label className="label" htmlFor="relationshipOther">How are you related to the student?</label>
                <input {...inputProps('relationshipOther')} maxLength={NAME_MAX} autoComplete="off"
                />
                {fieldError('relationshipOther')}
              </div>
            )}
            <div className="field">
              <label className="label" htmlFor="address">Address</label>
              <input {...inputProps('address')} maxLength={ADDRESS_MAX} autoComplete="street-address"
              />
              {errors.address ? fieldError('address')
                : <p className="hint">House or block, street and barangay. Letters, numbers and , . # - / only.</p>}
            </div>
          </div>

          <div className="card">
            <h3>Grade Level</h3>
            <div className="field">
              <label className="label" htmlFor="gradeLevelId">Applying for</label>
              <select id="gradeLevelId" className="input" value={form.gradeLevelId} onChange={update('gradeLevelId')}>
                {grades.map((g) => {
                  const note = slotsText(g);
                  return (
                    <option key={g.id} value={g.id} disabled={note === 'full'}>
                      {g.name}{note ? ` (${note})` : ''}
                    </option>
                  );
                })}
              </select>
              {(() => {
                const picked = grades.find((g) => String(g.id) === String(form.gradeLevelId));
                const note = slotsText(picked);
                if (!note) return null;
                return <p className="hint">{note === 'full'
                  ? `${picked.name} has no slots left. Please choose another grade or ask the school office.`
                  : `${picked.name}: ${note}.`}</p>;
              })()}
            </div>
          </div>

          <div className="card">
            <h3>Required Documents</h3>
            <p className="hint">PDF, JPG or PNG only. Maximum 5 MB each. Every document listed here has to be attached before the application can be submitted.</p>
            {docTypes.length === 0 && <p className="hint">The school is not asking for any documents right now.</p>}
            {docTypes.map((d) => [d.code, d.label]).map(([docType, label]) => (
              <div className="field" key={docType}>
                <label className="label" htmlFor={`file_${docType}`}>{label}</label>
                <input id={`file_${docType}`} className={`input${fileErrors[docType] ? ' input-error' : ''}`} type="file"
                  accept={FILE_ACCEPT} onChange={pickFile(docType)} />
                {fileErrors[docType] && <p className="field-error">{fileErrors[docType]}</p>}
              </div>
            ))}
          </div>

          {missingDocs.length > 0 && (
            <div className="alert alert-warn" role="status">
              <b>Still to attach before you can submit:</b>
              <ul style={{ margin: '4px 0 0 18px' }}>
                {missingDocs.map((d) => <li key={d.code}>{d.label}</li>)}
              </ul>
            </div>
          )}

          <div className="btn-row">
            <button className="btn btn-primary" type="submit"
              disabled={submitting || Boolean(freshPartial)}
              title={missingDocs.length ? 'Attach every required document first' : undefined}>
              {submitting ? 'Submitting\u2026' : 'Submit Application'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/dashboard')}>Cancel</button>
          </div>
        </form>
        </EnrollmentGate>
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
            <p>{enrollment.year ? `School Year ${enrollment.year}` : ''}</p>
          </div>
        </div>
<EnrollmentGate closed={enrollment.isClosed} title={enrollment.title} message={enrollment.message}>

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
      </EnrollmentGate>
</div>
    </>
  );
}
