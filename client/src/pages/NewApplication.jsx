import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import AppNav from '../components/AppNav';
import { useScrollToError } from '../hooks/useScrollToError';

const GRADE_LEVELS = [
  { id: 1, name: 'Kinder' }, { id: 2, name: 'Grade 1' }, { id: 3, name: 'Grade 2' },
  { id: 4, name: 'Grade 3' }, { id: 5, name: 'Grade 4' }, { id: 6, name: 'Grade 5' }, { id: 7, name: 'Grade 6' },
];

const DOC_LABELS = {
  birth_certificate: 'Birth Certificate',
  form_138: 'Form 138 / Report Card',
  good_moral: 'Certificate of Good Moral Character',
};

// A student can't have been born in the future -- the date picker
// shouldn't even offer those days as an option.
const TODAY = new Date().toISOString().slice(0, 10);

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
  const [promoting, setPromoting] = useState(false);

  async function handleSearch(e) {
    e.preventDefault();
    setSearchError('');
    setResult(null);
    if (!lrn.trim()) {
      setSearchError('Enter an LRN to search.');
      return;
    }
    setSearching(true);
    try {
      const { data } = await api.get('/students/lookup', { params: { lrn: lrn.trim() } });
      setResult(data);
      setPromoFiles({});
    } catch (err) {
      setSearchError(err.response?.data?.message || 'Search failed.');
    } finally {
      setSearching(false);
    }
  }

  const pickPromoFile = (docType) => (e) => setPromoFiles({ ...promoFiles, [docType]: e.target.files[0] });

  async function handlePromote() {
    setSearchError('');
    setPromoting(true);
    try {
      const { data } = await api.post('/applications/promote', {
        studentId: result.student.id, gradeLevelId: result.nextGradeLevelId,
      });
      for (const [docType, file] of Object.entries(promoFiles)) {
        if (!file) continue;
        const fd = new FormData();
        fd.append('file', file);
        fd.append('docType', docType);
        await api.post(`/applications/${data.id}/documents`, fd);
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
  const [lrnError, setLrnError] = useState('');
  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const [files, setFiles] = useState({ birth_certificate: null, form_138: null, good_moral: null });
  const pickFile = (docType) => (e) => setFiles({ ...files, [docType]: e.target.files[0] });

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLrnError('');

    // LRN is optional here -- most first-time Kinder/Grade 1 entrants won't
    // have one yet, DepEd assigns it. But if one IS entered, it must look
    // like a real LRN, so a typo doesn't silently create an unfindable
    // record for next year's promotion search.
    // LRN is only genuinely optional for Kinder -- reaching Grade 1 or
    // above under the mandatory K-12 system means the student has
    // necessarily been enrolled somewhere in DepEd's system before, so
    // they should already have one (this is a transferee, not a
    // first-timer). Per DepEd policy, new LRNs are issued immediately
    // only at Kinder entry (or Grade 1 via the KCEP catch-up track,
    // which this simple form doesn't distinguish from a transferee).
    const isKinder = form.gradeLevelId === '1';
    if (!isKinder && !form.lrn.trim()) {
      setLrnError('LRN is required for Grade 1 and above \u2014 only Kinder entrants may not have one yet.');
      return;
    }
    if (form.lrn && !/^\d{12}$/.test(form.lrn.trim())) {
      setLrnError('LRN should be exactly 12 digits.');
      return;
    }

    try {
      const { data } = await api.post('/applications', { ...form, lrn: form.lrn.trim() || undefined });
      for (const [docType, file] of Object.entries(files)) {
        if (!file) continue;
        const fd = new FormData();
        fd.append('file', file);
        fd.append('docType', docType);
        await api.post(`/applications/${data.id}/documents`, fd);
      }
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Submission failed.');
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
              <label className="label">LRN</label>
              <input className="input" value={lrn} onChange={(e) => setLrn(e.target.value)}
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
                    <input className="input" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={pickPromoFile(docType)} />
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

              <button className="btn btn-primary" style={{ width: '100%' }} onClick={handlePromote} disabled={promoting}>
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
          {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="card">
            <h3>Student Information</h3>
            <div className="field-grid cols-3">
              <div><label className="label">First name</label>
                <input className="input" value={form.firstName} onChange={update('firstName')} required /></div>
              <div><label className="label">Middle name</label>
                <input className="input" value={form.middleName} onChange={update('middleName')} /></div>
              <div><label className="label">Last name</label>
                <input className="input" value={form.lastName} onChange={update('lastName')} required /></div>
            </div>
            <div className="field-grid cols-2">
              <div><label className="label">Birth date</label>
                <input className="input" type="date" value={form.birthDate} onChange={update('birthDate')} max={TODAY} required /></div>
              <div><label className="label">Sex</label>
                <select className="input" value={form.sex} onChange={update('sex')}>
                  <option value="F">Female</option><option value="M">Male</option>
                </select></div>
            </div>
            <div className="field">
              <label className="label">
                Learner Reference Number (LRN){form.gradeLevelId === '1' ? ' \u2014 if already assigned' : ''}
              </label>
              <input className={`input${lrnError ? ' input-error' : ''}`} value={form.lrn} onChange={update('lrn')}
                placeholder="12-digit LRN" maxLength={12} required={form.gradeLevelId !== '1'} />
              {lrnError
                ? <p className="field-error">{lrnError}</p>
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
              <div><label className="label">Your first name</label>
                <input className="input" value={form.guardianFirstName} onChange={update('guardianFirstName')} required /></div>
              <div><label className="label">Your last name</label>
                <input className="input" value={form.guardianLastName} onChange={update('guardianLastName')} required /></div>
            </div>
            <div className="field-grid cols-2">
              <div><label className="label">Relationship to student</label>
                <select className="input" value={form.relationship} onChange={update('relationship')}>
                  <option>Mother</option><option>Father</option><option>Guardian</option>
                </select></div>
              <div><label className="label">Contact number</label>
                <input className="input" value={form.contactNumber} onChange={update('contactNumber')} required /></div>
            </div>
            <div className="field">
              <label className="label">Address</label>
              <input className="input" value={form.address} onChange={update('address')} required />
            </div>
          </div>

          <div className="card">
            <h3>Grade Level</h3>
            <div className="field">
              <label className="label">Applying for</label>
              <select className="input" value={form.gradeLevelId} onChange={update('gradeLevelId')}>
                {GRADE_LEVELS.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          </div>

          <div className="card">
            <h3>Required Documents</h3>
            <p className="hint">PDF, JPG or PNG. Maximum 5MB each.</p>
            <div className="field">
              <label className="label">Birth Certificate</label>
              <input className="input" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={pickFile('birth_certificate')} />
            </div>
            <div className="field">
              <label className="label">Form 138 / Report Card</label>
              <input className="input" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={pickFile('form_138')} />
            </div>
            <div className="field">
              <label className="label">Certificate of Good Moral Character</label>
              <input className="input" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={pickFile('good_moral')} />
            </div>
          </div>

          <div className="btn-row">
            <button className="btn btn-primary" type="submit">Submit Application</button>
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
