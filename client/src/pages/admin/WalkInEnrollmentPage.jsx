import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminWalkIn } from '../../api/walkIn';
import useEnrollment from '../../hooks/useEnrollment';
import ConfirmDialog from '../../components/ConfirmDialog';
import MiddleNameField from '../../components/MiddleNameField';
import { sampleFor } from '../../utils/samplePlaceholders';
import {
  validateName, validateContactNumber, validateAddress, validateLrn, validateBirthDate,
  validateBirthDateForGrade, validateGmail, validateConfirmGmail, validateMiddleName,
  birthDateBounds, sanitizePhone, sanitizeLrn, normalizeGmail,
  RELATIONSHIPS, NAME_MAX, ADDRESS_MAX,
} from '../../utils/validators';

const BIRTH_BOUNDS = birthDateBounds();

// One rule per field, shared by the live checks and the submit check. The
// server repeats every rule, so this is only here to give clear, early
// messages. `context` carries what a rule needs beyond the form itself:
// the chosen grade level (for the age window) and the school year start.
function validateField(name, form, context = {}) {
  switch (name) {
    case 'guardianEmail': return validateGmail(form.guardianEmail, { label: 'Parent\u2019s Gmail' });
    case 'confirmEmail': return validateConfirmGmail(form.guardianEmail, form.confirmEmail);
    // The guardian fields are only the staff member's to fill in when this
    // Gmail has no account yet. For an account that already exists they are
    // read-only and come from the parent's own profile, so there is nothing
    // to check here.
    case 'guardianFirstName': return context.guardianLocked ? '' : validateName(form.guardianFirstName, { label: 'First name' });
    case 'guardianMiddleName':
      return context.guardianLocked ? '' : validateMiddleName(form.guardianMiddleName, { none: form.guardianNoMiddleName });
    case 'guardianLastName': return context.guardianLocked ? '' : validateName(form.guardianLastName, { label: 'Last name' });
    case 'guardianContactNumber': return context.guardianLocked ? '' : validateContactNumber(form.guardianContactNumber);
    case 'guardianAddress': return context.guardianLocked ? '' : validateAddress(form.guardianAddress);
    case 'relationship': return form.relationship ? '' : 'Choose how this person is related to the learner.';
    case 'relationshipOther':
      return form.relationship === 'Other'
        ? validateName(form.relationshipOther, { label: 'Relationship' })
        : '';
    case 'firstName': return form.isNewStudent ? validateName(form.firstName, { label: 'First name' }) : '';
    case 'middleName':
      return form.isNewStudent ? validateMiddleName(form.middleName, { none: form.noMiddleName }) : '';
    case 'lastName': return form.isNewStudent ? validateName(form.lastName, { label: 'Last name' }) : '';
    case 'birthDate':
      if (!form.isNewStudent) return '';
      return context.grade
        ? validateBirthDateForGrade(form.birthDate, context.grade, context.yearStartsOn)
        : validateBirthDate(form.birthDate);
    case 'sex': return form.isNewStudent && !form.sex ? 'Choose Male or Female.' : '';
    case 'lrn': return form.isNewStudent ? validateLrn(form.lrn) : '';
    case 'gradeLevelId': return form.gradeLevelId ? '' : 'Choose a grade level.';
    case 'sectionId': return form.sectionId ? '' : 'Choose the section the learner joins.';
    case 'gradeQualificationMet':
      return context.needsQualification && !form.gradeQualificationMet
        ? 'Confirm the learner finished the grade level before this one.'
        : '';
    default: return '';
  }
}

const ALL_FIELDS = [
  'guardianEmail', 'confirmEmail', 'guardianFirstName', 'guardianMiddleName', 'guardianLastName',
  'guardianContactNumber', 'guardianAddress', 'relationship', 'relationshipOther',
  'firstName', 'middleName', 'lastName', 'birthDate',
  'sex', 'lrn', 'gradeLevelId', 'sectionId', 'gradeQualificationMet',
];

const emptyForm = {
  isNewStudent: true,
  firstName: '', middleName: '', noMiddleName: false, lastName: '', birthDate: '', sex: '', lrn: '',
  existingStudentId: null,
  guardianEmail: '', confirmEmail: '', guardianFirstName: '',
  guardianMiddleName: '', guardianNoMiddleName: false, guardianLastName: '',
  guardianContactNumber: '', guardianAddress: '', guardianValidIdType: '',
  relationship: '', relationshipOther: '',
  gradeLevelId: '', sectionId: '', gradeQualificationMet: false,
};

// Shared by the admin and registrar portals: `client` picks which API prefix
// is used, `staffLabel` only changes the wording of the intro line.
export default function WalkInEnrollmentPage({ client = adminWalkIn, staffLabel = 'Admin-assisted' }) {
  const [form, setForm] = useState(emptyForm);
  const [gradeLevels, setGradeLevels] = useState([]);
  const enrollment = useEnrollment();
  const seats = enrollment.grades;   // slots left per grade
  // Age for a grade level is counted on the first day of classes.
  const yearStartsOn = enrollment.schoolYear?.classesStartOn || enrollment.enrollment?.opensOn || '';
  const [docTypes, setDocTypes] = useState([]);
  const [checkedDocs, setCheckedDocs] = useState([]);
  const [lrnQuery, setLrnQuery] = useState('');
  const [lrnResult, setLrnResult] = useState(null); // null | 'not_found' | student object
  const [lrnSearching, setLrnSearching] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null); // { accountEmail, accountCreated, sectionName, ... }
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  // What the server knows about the Gmail that was typed:
  // null (nothing checked yet) | 'checking' | { exists, usable, guardian, ... }
  const [account, setAccount] = useState(null);
  // A learner already on file under the same name and birth date.
  const [duplicate, setDuplicate] = useState(null); // null | 'checking' | student object
  // Tells the person when the lists could not be loaded, instead of showing
  // an empty drop-down with no explanation.
  const [gradesLoaded, setGradesLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  // The sections of the chosen grade, with how many seats each has left.
  const [sections, setSections] = useState([]);
  const [sectionsLoading, setSectionsLoading] = useState(false);

  useEffect(() => {
    client.gradeLevels()
      .then((rows) => { setGradeLevels(rows); setGradesLoaded(true); })
      .catch(() => setLoadError('We could not load the grade levels. Please refresh the page or sign in again.'));
    client.documentTypes()
      .then(setDocTypes)
      .catch(() => setLoadError('We could not load the lists for this form. Please refresh the page or sign in again.'));
  }, [client]);

  const grade = useMemo(
    () => gradeLevels.find((g) => String(g.id) === String(form.gradeLevelId)) || null,
    [gradeLevels, form.gradeLevelId]
  );
  // An account that already exists owns its own details: the parent's saved
  // profile is what they sign in against, so the desk cannot retype it here.
  const guardianLocked = Boolean(account && account !== 'checking' && account.exists && account.guardian);
  // Kinder is the entry grade: there is no grade behind it to have finished.
  const needsQualification = Boolean(grade && grade.sortOrder > 0);
  const context = useMemo(
    () => ({
      grade: grade ? { sortOrder: grade.sortOrder, name: grade.name } : null,
      yearStartsOn, guardianLocked, needsQualification,
    }),
    [grade, yearStartsOn, guardianLocked, needsQualification]
  );
  const contextRef = useRef(context);
  contextRef.current = context;

  const check = useCallback((field, next) => validateField(field, next, contextRef.current), []);

  // ---- "Does this Gmail already have an account?" -------------------------
  // Runs while the address is being typed, a short moment after the typing
  // stops. The answer decides whether the guardian fields below are the
  // staff member's to fill in at all.
  const email = normalizeGmail(form.guardianEmail);
  const emailLooksValid = !validateGmail(email);
  useEffect(() => {
    if (!emailLooksValid) { setAccount(null); return undefined; }
    let alive = true;
    setAccount('checking');
    const timer = setTimeout(() => {
      client.guardianLookup(email)
        .then((data) => {
          if (!alive) return;
          setAccount(data);
          // Show the parent's saved details in the (now read-only) fields.
          if (data.exists && data.guardian) {
            setForm((f) => ({
              ...f,
              guardianFirstName: data.guardian.firstName || '',
              guardianMiddleName: data.guardian.middleName || '',
              guardianNoMiddleName: !data.guardian.middleName,
              guardianLastName: data.guardian.lastName || '',
              guardianContactNumber: data.guardian.contactNumber || '',
              guardianAddress: data.guardian.address || '',
              guardianValidIdType: data.guardian.validIdType || '',
            }));
            setErrors((prev) => ({
              ...prev,
              guardianFirstName: '', guardianMiddleName: '', guardianLastName: '',
              guardianContactNumber: '', guardianAddress: '',
            }));
          }
        })
        .catch(() => { if (alive) setAccount(null); });
    }, 450);
    return () => { alive = false; clearTimeout(timer); };
  }, [email, emailLooksValid, client]);

  // ---- "Is this learner already on file?" ---------------------------------
  // By name alone: two learners may not share a name, whatever grade level
  // they are in, because a master list could not tell them apart.
  const dupKey = form.isNewStudent
    ? `${form.firstName.trim().toLowerCase()}|${form.middleName.trim().toLowerCase()}|${form.lastName.trim().toLowerCase()}`
    : '';
  useEffect(() => {
    const [first, , last] = dupKey.split('|');
    if (!first || !last) { setDuplicate(null); return undefined; }
    let alive = true;
    setDuplicate('checking');
    const timer = setTimeout(() => {
      client.studentDuplicate({
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim() || undefined,
        lastName: form.lastName.trim(),
      })
        .then((data) => { if (alive) setDuplicate(data.duplicate ? data.student : null); })
        .catch(() => { if (alive) setDuplicate(null); });
    }, 500);
    return () => { alive = false; clearTimeout(timer); };
    // form fields are read through dupKey, which is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dupKey, client]);

  // The sections of the chosen grade, loaded as soon as one is chosen, so the
  // desk can place the learner without leaving the form.
  useEffect(() => {
    if (!form.gradeLevelId) { setSections([]); return undefined; }
    let alive = true;
    setSectionsLoading(true);
    client.sections(form.gradeLevelId)
      .then((rows) => { if (alive) setSections(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (alive) setSections([]); })
      .finally(() => { if (alive) setSectionsLoading(false); });
    return () => { alive = false; };
  }, [form.gradeLevelId, client]);

  // The birth date is checked against the grade level, so changing the grade
  // re-checks a birth date that was already typed.
  useEffect(() => {
    setErrors((prev) => (prev.birthDate !== undefined || form.birthDate
      ? { ...prev, birthDate: check('birthDate', form) }
      : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.gradeLevelId, form.birthDate, yearStartsOn]);

  function toggleDoc(code) {
    setCheckedDocs((d) => d.includes(code) ? d.filter((x) => x !== code) : [...d, code]);
  }

  function switchMode(isNew) {
    setForm((f) => ({
      ...emptyForm,
      isNewStudent: isNew,
      gradeLevelId: f.gradeLevelId,
      // Whatever is known about the parent stays: only the learner changes.
      guardianEmail: f.guardianEmail,
      confirmEmail: f.confirmEmail,
      guardianFirstName: f.guardianFirstName,
      guardianMiddleName: f.guardianMiddleName,
      guardianNoMiddleName: f.guardianNoMiddleName,
      guardianLastName: f.guardianLastName,
      guardianContactNumber: f.guardianContactNumber,
      guardianAddress: f.guardianAddress,
      guardianValidIdType: f.guardianValidIdType,
      relationship: f.relationship,
      relationshipOther: f.relationshipOther,
    }));
    setLrnQuery('');
    setLrnResult(null);
    setDuplicate(null);
    setCheckedDocs([]);
  }

  // Standard wiring for one text field: value, change (checks as it is typed),
  // blur (checks it again, including "this is required") and the red outline
  // when it has a problem.
  const bind = (field) => ({
    id: `walkin_${field}`,
    className: `input${errors[field] ? ' input-error' : ''}`,
    value: form[field],
    onChange: (e) => {
      const next = { ...form, [field]: e.target.value };
      setForm(next);
      // Warn while typing, but do not say "this is required" about a field
      // the person has not finished with yet.
      const problem = check(field, next);
      const stillEmpty = !String(next[field] || '').trim();
      setErrors((prev) => ({ ...prev, [field]: stillEmpty && !touched[field] ? '' : problem }));
      if (field === 'guardianEmail' && (touched.confirmEmail || next.confirmEmail)) {
        setErrors((prev) => ({ ...prev, confirmEmail: check('confirmEmail', next) }));
      }
    },
    onBlur: () => {
      setTouched((prev) => ({ ...prev, [field]: true }));
      setErrors((prev) => ({ ...prev, [field]: check(field, form) }));
    },
    // An example of the format while the box is empty. A placeholder written
    // on the box itself wins, since it comes after this spread.
    placeholder: sampleFor(field),
    'aria-invalid': errors[field] ? 'true' : undefined,
  });
  const fieldError = (field) => (errors[field] ? <p className="field-error">{errors[field]}</p> : null);

  // Ticking "No middle name" clears the box and settles the field.
  const toggleNoMiddle = (key, nameKey) => (checked) => {
    const next = { ...form, [key]: checked, ...(checked ? { [nameKey]: '' } : {}) };
    setForm(next);
    setErrors((prev) => ({ ...prev, [nameKey]: check(nameKey, next) }));
  };

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

  // An enrollment at the desk creates a parent account and holds a seat, so
  // the form asks before it does either.
  const [confirming, setConfirming] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return; // ignore a double click
    setError('');
    setSuccess(null);

    if (account && account !== 'checking' && account.exists && account.usable === false) {
      setError(account.reason);
      document.getElementById('walkin_guardianEmail')?.focus();
      return;
    }
    if (duplicate && duplicate !== 'checking') {
      setError(duplicate.message
        || 'A learner with this name is already on file. Two learners cannot share a name, even in different grade levels.');
      return;
    }

    // Check every field at once so the staff member sees all the problems together.
    const found = {};
    ALL_FIELDS.forEach((f) => { found[f] = check(f, form); });
    setErrors(found);
    setTouched(Object.fromEntries(ALL_FIELDS.map((f) => [f, true])));
    const firstBad = ALL_FIELDS.find((f) => found[f]);
    if (firstBad) {
      setError('Please correct the highlighted fields and try again.');
      document.getElementById(`walkin_${firstBad}`)?.focus();
      return;
    }
    // A walk-in is completed at the desk, so nothing may be outstanding.
    if (missingDocs.length) {
      setError(`Verify ${missingDocs.map((d) => d.label).join(', ')} before enrolling. `
        + 'A walk-in is completed at the desk, so every requirement has to be in hand.');
      document.getElementById('walkin_docs')?.scrollIntoView({ block: 'center' });
      return;
    }
    setConfirming(true);
  }

  async function submitEnrollment() {
    setSaving(true);
    setError('');
    try {
      // Empty strings must become undefined: the server treats a
      // blank sectionId as 0 and rejects it, and a blank LRN as invalid.
      const payload = form.isNewStudent
        ? { ...form, lrn: form.lrn.trim() || undefined }
        : { ...form, isNewStudent: false, existingStudentId: form.existingStudentId };
      const result = await client.create({
        ...payload,
        guardianEmail: normalizeGmail(form.guardianEmail),
        guardianConfirmEmail: normalizeGmail(form.confirmEmail),
        guardianMiddleName: form.guardianNoMiddleName ? undefined : form.guardianMiddleName.trim() || undefined,
        guardianNoMiddleName: form.guardianNoMiddleName,
        middleName: form.noMiddleName ? undefined : form.middleName.trim() || undefined,
        guardianAddress: form.guardianAddress.trim().replace(/\s+/g, ' '),
        guardianValidIdType: form.guardianValidIdType.trim() || undefined,
        relationship: form.relationship,
        relationshipOther: form.relationship === 'Other' ? form.relationshipOther.trim() : undefined,
        sectionId: form.sectionId,
        gradeQualificationMet: Boolean(form.gradeQualificationMet),
        physicalDocTypes: checkedDocs,
      });
      setSuccess(result);
      setForm(emptyForm);
      setErrors({});
      setTouched({});
      setCheckedDocs([]);
      setLrnQuery('');
      setLrnResult(null);
      setAccount(null);
      setDuplicate(null);
      setConfirming(false);
    } catch (err) {
      setConfirming(false);
      const data = err.response?.data;
      if (data?.reason === 'duplicate_name') setDuplicate({ id: data.studentId, pending: true, message: data.message });
      if (data?.reason === 'section_full') {
        setErrors((prev) => ({ ...prev, sectionId: data.message }));
        // Another desk may have taken the last seat while this form was open.
        client.sections(form.gradeLevelId).then(setSections).catch(() => {});
      }
      if (data?.reason === 'qualification_required') {
        setErrors((prev) => ({ ...prev, gradeQualificationMet: data.message }));
      }
      if (data?.reason === 'birth_date_invalid') {
        setErrors((prev) => ({ ...prev, birthDate: data.message }));
        document.getElementById('walkin_birthDate')?.focus();
      }
      setError(data?.errors?.map((x) => x.message).join(' ') || data?.message || 'Could not complete this enrollment.');
    } finally {
      setSaving(false);
    }
  }

  // A returning student must be found by LRN first; a duplicate learner or an
  // unusable account blocks the submit button outright.
  const accountBlocks = Boolean(account && account !== 'checking'
    && ((account.exists && account.usable === false) || account.deliverable === false));
  // Nothing is enrolled with a requirement outstanding: a walk-in is finished
  // at the counter, so every required document has to be verified now.
  const missingDocs = docTypes.filter((d) => !checkedDocs.includes(d.code));
  // A learner the LRN search found already enrolled for this school year
  // cannot be enrolled a second time.
  const alreadyEnrolled = lrnResult && lrnResult !== 'not_found' ? lrnResult.already_enrolled || null : null;

  const canSubmit = (form.isNewStudent || !!form.existingStudentId)
    && !accountBlocks
    && !alreadyEnrolled
    && !(duplicate && duplicate !== 'checking');

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
          {success.sectionName && (
            <div style={{ marginTop: 4 }}>
              Enrolled in <b>{success.gradeLevelName} &mdash; {success.sectionName}</b>.
            </div>
          )}
          {success.accountCreated ? (
            <>
              <div style={{ marginTop: 4 }}>
                A new parent account was created. There is no temporary password to hand over.
              </div>
              <div style={{ marginTop: 4 }}>
                {success.verificationSent === false
                  ? 'The setup email could not be sent just now. The parent can ask for a new link from the sign-in page using Forgot password.'
                  : 'A link was emailed to that Gmail. The parent opens it once, chooses their own password, and that confirms the address at the same time \u2014 if nothing arrives, the address was mistyped and the enrollment needs correcting.'}
              </div>
            </>
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
              <label className="label" htmlFor="walkin_guardianEmail">Parent&rsquo;s Gmail</label>
              <input
                {...bind('guardianEmail')} type="email" autoComplete="off" maxLength={254}
              />
              {fieldError('guardianEmail')}
              {/* What the server knows about this address, as it is typed. */}
              {!errors.guardianEmail && account === 'checking' && (
                <p className="hint" role="status">Checking this Gmail&hellip;</p>
              )}
              {!errors.guardianEmail && account && account !== 'checking' && !account.exists
                && account.deliverable === false && (
                <p className="field-error" role="alert">
                  {account.deliverableReason} Check the spelling with the parent.
                </p>
              )}
              {!errors.guardianEmail && account && account !== 'checking' && !account.exists
                && account.deliverable !== false && (
                <p className="hint account-new" role="status">
                  This account is not yet registered. Enter its details below.
                </p>
              )}
              {!errors.guardianEmail && account && account !== 'checking' && account.exists && account.usable !== false && (
                <p className="hint account-found" role="status">
                  This Gmail already has a parent account
                  {account.children > 0 && ` with ${account.children} ${account.children === 1 ? 'learner' : 'learners'} on file`}.
                  {' '}It will be reused, and its details cannot be changed here.
                </p>
              )}
            </div>
            <div>
              <label className="label" htmlFor="walkin_confirmEmail">Confirm Gmail</label>
              <input
                {...bind('confirmEmail')} type="email" autoComplete="off" maxLength={254}
              />
              {fieldError('confirmEmail')}
            </div>
          </div>

          {accountBlocks && (
            <div className="alert alert-error" style={{ marginTop: 10 }}>
              {account.reason || account.deliverableReason}
            </div>
          )}
          {guardianLocked && (
            <div className="alert alert-warn" style={{ marginTop: 10 }} role="status">
              <b>This parent is already registered.</b> The details below are the ones on their account and are
              shown for checking only &mdash; they cannot be edited from this page. If something is out of date,
              the parent can correct it in their own account settings.
            </div>
          )}

          <p className="hint">
            Double-check this with the parent. A mistyped address would link the child&rsquo;s application to the wrong person.
          </p>
          <fieldset className="plain-fieldset" disabled={guardianLocked}>
            <div className="field-grid cols-3">
              <div><label className="label" htmlFor="walkin_guardianFirstName">First name</label>
                <input {...bind('guardianFirstName')} maxLength={NAME_MAX} />{fieldError('guardianFirstName')}</div>
              <MiddleNameField
                id="walkin_guardianMiddleName" value={form.guardianMiddleName} none={form.guardianNoMiddleName}
                error={errors.guardianMiddleName}
                onChange={bind('guardianMiddleName').onChange} onBlur={bind('guardianMiddleName').onBlur}
                onToggleNone={toggleNoMiddle('guardianNoMiddleName', 'guardianMiddleName')}
              />
              <div><label className="label" htmlFor="walkin_guardianLastName">Last name</label>
                <input {...bind('guardianLastName')} maxLength={NAME_MAX} />{fieldError('guardianLastName')}</div>
            </div>
            <div className="field-grid cols-3">
              <div><label className="label" htmlFor="walkin_guardianContactNumber">Contact number</label>
                <input {...bind('guardianContactNumber')} inputMode="tel" maxLength={13}
                  onChange={(e) => bind('guardianContactNumber').onChange({ target: { value: sanitizePhone(e.target.value) } })} />
                {errors.guardianContactNumber ? fieldError('guardianContactNumber')
                  : <p className="hint">09XXXXXXXXX, or +639XXXXXXXXX</p>}</div>
              <div><label className="label" htmlFor="walkin_guardianAddress">Address</label>
                <input {...bind('guardianAddress')} maxLength={ADDRESS_MAX}
                />
                {errors.guardianAddress ? fieldError('guardianAddress')
                  : <p className="hint">Letters, numbers and , . # - / only.</p>}</div>
            </div>
          </fieldset>

          {/* How this guardian is related to THIS learner belongs to the
              enrollment, not to the parent's saved account, so it stays
              editable even when the account itself is read-only. */}
          <div className="field-grid cols-2">
              <div><label className="label" htmlFor="walkin_relationship">Relationship to student</label>
                <select
                  id="walkin_relationship"
                  className={`input${errors.relationship ? ' input-error' : ''}`}
                  value={form.relationship}
                  onChange={(e) => {
                    const next = { ...form, relationship: e.target.value };
                    setForm(next);
                    setErrors((prev) => ({
                      ...prev,
                      relationship: check('relationship', next),
                      relationshipOther: check('relationshipOther', next),
                    }));
                  }}
                >
                  <option value="">Select</option>
                  {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                {fieldError('relationship')}</div>
            {form.relationship === 'Other' && (
              <div>
                <label className="label" htmlFor="walkin_relationshipOther">How is this person related to the learner?</label>
                <input {...bind('relationshipOther')} maxLength={NAME_MAX}
                />
                {fieldError('relationshipOther')}
              </div>
            )}
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
              <div><label className="label" htmlFor="walkin_firstName">First name</label>
                <input {...bind('firstName')} maxLength={NAME_MAX} />{fieldError('firstName')}</div>
              <MiddleNameField
                id="walkin_middleName" value={form.middleName} none={form.noMiddleName}
                error={errors.middleName}
                onChange={bind('middleName').onChange} onBlur={bind('middleName').onBlur}
                onToggleNone={toggleNoMiddle('noMiddleName', 'middleName')}
              />
              <div><label className="label" htmlFor="walkin_lastName">Last name</label>
                <input {...bind('lastName')} maxLength={NAME_MAX} />{fieldError('lastName')}</div>
            </div>
            <div className="field-grid cols-3">
              <div><label className="label" htmlFor="walkin_birthDate">Birth date</label>
                <input {...bind('birthDate')} type="date" max={BIRTH_BOUNDS.max} />
                {fieldError('birthDate')}</div>
              <div>
                <label className="label" htmlFor="walkin_sex">Sex</label>
                <select {...bind('sex')}>
                  <option value="">Select</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
                {fieldError('sex')}
              </div>
              {/* Anyone entering above Kinder has been enrolled somewhere before,
                  so DepEd has already issued them an LRN and it is required.
                  The label says which case this is rather than leaving the desk
                  to find out from the refusal. */}
              <div>
                <label className="label" htmlFor="walkin_lrn">
                  LRN{needsQualification ? '' : ' (if already assigned)'}
                </label>
                <input {...bind('lrn')} inputMode="numeric" maxLength={12}
                  onChange={(e) => bind('lrn').onChange({ target: { value: sanitizeLrn(e.target.value) } })} />
                {fieldError('lrn')}
              </div>
            </div>

            {/* A learner already on file under this name and birth date. */}
            {duplicate === 'checking' && <p className="hint" role="status">Checking for an existing record&hellip;</p>}
            {duplicate && duplicate !== 'checking' && (
              <div className="alert alert-error" style={{ marginTop: 10 }} role="alert">
                <b>That name is already taken.</b>
                <div style={{ marginTop: 4 }}>
                  {duplicate.last_name
                    ? <>{duplicate.last_name}, {duplicate.first_name}{duplicate.middle_name ? ` ${duplicate.middle_name}` : ''} is already on file.</>
                    : <>A learner with this name is already on file.</>}
                  {duplicate.last_enrollment && (
                    <div className="cell-sub">
                      Currently {duplicate.last_enrollment.grade_level_name}
                      {duplicate.last_enrollment.section_name ? `, ${duplicate.last_enrollment.section_name}` : ''}
                      {' '}&middot; SY {duplicate.last_enrollment.school_year_label} ({duplicate.last_enrollment.status})
                    </div>
                  )}
                </div>
                <div style={{ marginTop: 8 }}>
                  Two learners cannot share a name, even in different grade levels. If this is the same child, use{' '}
                  <button type="button" className="link-button" onClick={() => switchMode(false)}>
                    Old / Returning Student
                  </button>{' '}and search by LRN. If it is a different child, add a middle name to tell them apart.
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="card">
            <strong>Search by Learner Reference Number (LRN)</strong>
            <p className="hint">Check the student ID or the Form 137 the parent brought in.</p>
            <div className="btn-row" style={{ marginBottom: 10 }}>
              <input className="input" style={{ maxWidth: 220 }} placeholder="1234xxxxxxxx" value={lrnQuery} inputMode="numeric" maxLength={12}
                aria-label="LRN"
                onChange={(e) => setLrnQuery(sanitizeLrn(e.target.value))} />
              <button className="btn btn-secondary" type="button" onClick={handleLrnSearch} disabled={lrnSearching}>
                {lrnSearching ? 'Searching...' : 'Search'}
              </button>
            </div>
            {lrnResult === 'not_found' && <p style={{ color: 'var(--danger)', fontSize: 14.5 }}>No student found with that LRN.</p>}
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
                <span className={`pill ${alreadyEnrolled ? 'pill-rejected' : 'pill-approved'}`}>
                  {alreadyEnrolled ? 'Already enrolled' : 'Matched'}
                </span>
              </div>
            )}
            {alreadyEnrolled && (
              <div className="alert alert-error" style={{ marginTop: 10 }}>{alreadyEnrolled.message}</div>
            )}
          </div>
        )}

        <div className="card">
          <strong>Grade Level</strong>
          <div className="field-grid cols-2" style={{ marginTop: 10 }}>
            <div>
              <label className="label" htmlFor="walkin_gradeLevelId">Applying for</label>
              <select
                {...bind('gradeLevelId')}
                onChange={(e) => {
                  // A section belongs to one grade, so changing the grade
                  // clears the section rather than carrying a wrong one over.
                  setForm({ ...form, gradeLevelId: e.target.value, sectionId: '' });
                  setErrors((prev) => ({ ...prev, gradeLevelId: e.target.value ? '' : prev.gradeLevelId, sectionId: '' }));
                }}
              >
                <option value="">Select grade level</option>
                {gradeLevels.map((g) => {
                  const sg = seats.find((x) => x.id === g.id);
                  const full = Boolean(sg && sg.totalSlots && sg.slotsLeft <= 0);
                  return <option key={g.id} value={g.id} disabled={full}>{g.name}{full ? ' (full)' : sg && sg.totalSlots ? ` (${sg.slotsLeft} ${sg.slotsLeft === 1 ? 'slot' : 'slots'} left)` : ''}</option>;
                })}
              </select>
              {fieldError('gradeLevelId')}
              {loadError && <p className="field-error">{loadError}</p>}
              {!loadError && gradesLoaded && gradeLevels.length === 0 && (
                <p className="field-error">No grade levels have been set up yet. Please ask the administrator to add them.</p>
              )}
            </div>
            <div>
              <label className="label" htmlFor="walkin_sectionId">Section</label>
              <select
                id="walkin_sectionId"
                className={`input${errors.sectionId ? ' input-error' : ''}`}
                value={form.sectionId}
                disabled={!form.gradeLevelId || sectionsLoading}
                onChange={(e) => {
                  setForm({ ...form, sectionId: e.target.value });
                  setErrors((prev) => ({ ...prev, sectionId: e.target.value ? '' : prev.sectionId }));
                }}
              >
                <option value="">
                  {!form.gradeLevelId ? 'Choose a grade level first'
                    : sectionsLoading ? 'Loading sections\u2026' : 'Select section'}
                </option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id} disabled={s.slots_left <= 0}>
                    {s.name} {s.slots_left <= 0 ? '(full)' : `(${s.slots_left} of ${s.capacity} left)`}
                  </option>
                ))}
              </select>
              {errors.sectionId ? fieldError('sectionId')
                : <p className="hint">The learner joins this section today. A walk-in is completed at the desk, not reviewed later.</p>}
              {form.gradeLevelId && !sectionsLoading && sections.length === 0 && (
                <p className="field-error">
                  This grade level has no sections yet. Add one in School Settings before enrolling into it.
                </p>
              )}
            </div>
          </div>

          {needsQualification && (
            <div className="field" style={{ marginTop: 4 }}>
              <label className={`check-row${errors.gradeQualificationMet ? ' check-row-error' : ''}`} htmlFor="walkin_gradeQualificationMet">
                <input
                  id="walkin_gradeQualificationMet"
                  type="checkbox"
                  checked={Boolean(form.gradeQualificationMet)}
                  onChange={(e) => {
                    const next = { ...form, gradeQualificationMet: e.target.checked };
                    setForm(next);
                    setErrors((prev) => ({ ...prev, gradeQualificationMet: check('gradeQualificationMet', next) }));
                  }}
                />
                <span>
                  I have seen the Form 137 or Form 138 showing this learner completed the grade level
                  before {grade ? grade.name : 'this one'}.
                </span>
              </label>
              {fieldError('gradeQualificationMet')}
            </div>
          )}
        </div>

        <div className="card">
          <strong id="walkin_docs">Requirements Verified</strong>
          <p className="hint">
            Tick each document as you check it against the original. All of them have to be verified
            before the learner can be enrolled &mdash; a walk-in is completed at the desk, so nothing
            is left to follow up on. The list comes from System Settings.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {docTypes.map((d) => (
              <label key={d.code} className="check-row">
                <input type="checkbox" checked={checkedDocs.includes(d.code)} onChange={() => toggleDoc(d.code)} />
                {d.label}
              </label>
            ))}
          </div>
          {docTypes.length === 0 && <p className="hint">The school is not requiring any documents right now.</p>}
          {missingDocs.length > 0 && (
            <div className="alert alert-error" style={{ marginTop: 10 }} role="status">
              <b>Still to verify:</b> {missingDocs.map((d) => d.label).join(', ')}.
              <div style={{ marginTop: 4 }}>
                If the parent does not have all of them today, ask them to enroll online instead,
                where the missing papers can be uploaded later.
              </div>
            </div>
          )}
        </div>

        <button className="btn btn-primary" type="submit" disabled={saving || !canSubmit} style={{ width: '100%' }}>
          {saving ? 'Submitting...' : 'Submit on Behalf of Guardian'}
        </button>
      </form>

      {confirming && (
        <ConfirmDialog
          title="Submit this enrollment?"
          confirmLabel="Submit enrollment"
          busy={saving}
          onConfirm={submitEnrollment}
          onClose={() => setConfirming(false)}
        >
          <p>
            <b>{form.isNewStudent
              ? [form.lastName, form.firstName].filter(Boolean).join(', ')
              : lrnResult && lrnResult !== 'not_found'
                ? `${lrnResult.last_name}, ${lrnResult.first_name}`
                : 'the learner you found'}</b>
            {grade ? ` — ${grade.name}` : ''}
          </p>
          <p>
            Parent account: <b>{form.guardianEmail.trim().toLowerCase()}</b>
            {account && account !== 'checking' && account.exists
              ? ' (already registered, it will be reused)'
              : ' (a new account will be created; the parent sets their own password from the link we email them)'}
          </p>
          <p>
            Section: <b>{sections.find((s) => String(s.id) === String(form.sectionId))?.name || '\u2014'}</b>.
            The learner is enrolled into it as soon as you confirm.
          </p>
          <p>
            All {docTypes.length} required {docTypes.length === 1 ? 'document has' : 'documents have'} been verified.
            {needsQualification && ' The grade qualification is confirmed.'}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
