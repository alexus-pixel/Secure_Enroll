export default function WalkInEnrollment() {
  return <h1>Walk-In Enrollment</h1>;
}import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const GRADES = ['Kinder', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'];
const RELATIONSHIPS = ['Mother', 'Father', 'Guardian', 'Other'];

// Mock lookup until the API exists
const MOCK_LEARNERS = {
  '136482850173': { name: 'John Fedellaga', grade: 'Grade 5', section: 'Masipag', schoolYear: 'SY 2025-2026' },
};

const EMPTY_FORM = {
  firstName: '', middleName: '', lastName: '', birthDate: '', sex: 'Female',
  guardianFirst: '', guardianLast: '', relationship: 'Mother', contact: '', address: '',
  grade: 'Kinder',
};

export default function WalkInEnrollment() {
  const navigate = useNavigate();
  const [type, setType] = useState('new'); // 'new' | 'old'
  const [notice, setNotice] = useState(null);

  // New student
  const [form, setForm] = useState(EMPTY_FORM);
  const [docs, setDocs] = useState({ birth: false, form138: false, moral: false });

  // Old student
  const [lrn, setLrn] = useState('');
  const [learner, setLearner] = useState(null);
  const [form138, setForm138] = useState(false);

  const set = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  const toggleDoc = (key) => setDocs((d) => ({ ...d, [key]: !d[key] }));

  function switchType(next) {
    setType(next);
    setNotice(null);
  }

  function handleCreate() {
    const required = ['firstName', 'lastName', 'birthDate', 'guardianFirst', 'guardianLast', 'contact'];
    if (required.some((k) => !form[k].trim())) {
      setNotice({ type: 'error', text: 'Please fill in all required student and guardian fields.' });
      return;
    }
    // TODO: call API
    setNotice({ type: 'ok', text: 'Account created and application submitted.' });
    setForm(EMPTY_FORM);
    setDocs({ birth: false, form138: false, moral: false });
  }

  function handleSearch() {
    const found = MOCK_LEARNERS[lrn.trim()];
    setLearner(found || null);
    setForm138(false);
    setNotice(found ? null : { type: 'error', text: 'No record found for that LRN.' });
  }

  function handleSubmitOld() {
    if (!form138) {
      setNotice({ type: 'error', text: 'Mark the new Form 138 / Report Card as received first.' });
      return;
    }
    // TODO: call API
    setNotice({ type: 'ok', text: 'Promotion application submitted.' });
    setLearner(null);
    setLrn('');
    setForm138(false);
  }

  const nextGrade = learner ? GRADES[GRADES.indexOf(learner.grade) + 1] : null;

  return (
    <div className="reg-page reg-narrow">
      <h1 className="reg-title">Walk-in Enrollment</h1>
      <p className="reg-subtitle">Registrar-assisted - for parents completing a physical form.</p>

      <div className="reg-banner">
        <strong>Staff-assisted submission.</strong> Use this when a parent fills out a paper form at the
        registrar's desk instead of using the online portal.
      </div>

      {notice && <div className={`reg-notice reg-notice-${notice.type}`}>{notice.text}</div>}

      <div className="reg-card">
        <p className="reg-card-title">Is this student NEW or ALREADY ENROLLED before?</p>
        <p className="reg-help">Returning students (e.g. moving up from Grade 5 to Grade 6) can skip re-entering their information.</p>
        <div className="reg-options">
          <button className={`reg-option ${type === 'new' ? 'selected' : ''}`} onClick={() => switchType('new')}>
            {type === 'new' && <span className="reg-option-tag">SELECTED</span>}
            <h4>New Student</h4>
            <p>First time enrolling at Caloocan City Elementary School. Fill out full student and guardian information.</p>
          </button>
          <button className={`reg-option ${type === 'old' ? 'selected' : ''}`} onClick={() => switchType('old')}>
            {type === 'old' && <span className="reg-option-tag">SELECTED</span>}
            <h4>Old Student</h4>
            <p>Already has a Learner Reference Number (LRN) on file. Look up their existing record instead.</p>
          </button>
        </div>
      </div>

      {type === 'new' ? (
        <>
          <div className="reg-card">
            <p className="reg-card-title">Student Information</p>
            <div className="reg-row reg-row-3">
              <Field label="First name"><input className="reg-input" name="firstName" value={form.firstName} onChange={set} /></Field>
              <Field label="Middle name"><input className="reg-input" name="middleName" value={form.middleName} onChange={set} /></Field>
              <Field label="Last name"><input className="reg-input" name="lastName" value={form.lastName} onChange={set} /></Field>
            </div>
            <div className="reg-row reg-row-2">
              <Field label="Birth date"><input className="reg-input" type="date" name="birthDate" value={form.birthDate} onChange={set} /></Field>
              <Field label="Sex">
                <select className="reg-input" name="sex" value={form.sex} onChange={set}>
                  <option>Female</option>
                  <option>Male</option>
                </select>
              </Field>
            </div>
          </div>

          <div className="reg-card">
            <p className="reg-card-title">Guardian Information</p>
            <div className="reg-row reg-row-2">
              <Field label="Guardian first name"><input className="reg-input" name="guardianFirst" value={form.guardianFirst} onChange={set} /></Field>
              <Field label="Guardian last name"><input className="reg-input" name="guardianLast" value={form.guardianLast} onChange={set} /></Field>
            </div>
            <div className="reg-row reg-row-2">
              <Field label="Relationship to student">
                <select className="reg-input" name="relationship" value={form.relationship} onChange={set}>
                  {RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="Contact number"><input className="reg-input" name="contact" value={form.contact} onChange={set} /></Field>
            </div>
            <Field label="Address"><input className="reg-input" name="address" value={form.address} onChange={set} /></Field>
          </div>

          <div className="reg-card">
            <p className="reg-card-title">Grade Level</p>
            <Field label="Grade level applying for">
              <select className="reg-input" name="grade" value={form.grade} onChange={set}>
                {GRADES.map((g) => <option key={g}>{g}</option>)}
              </select>
            </Field>
          </div>

          <div className="reg-card">
            <p className="reg-card-title">Required Documents</p>
            <p className="reg-help">PDF, JPG or PNG. Maximum of 5MB each.</p>
            <ReceiveRow label="Birth Certificate" checked={docs.birth} onChange={() => toggleDoc('birth')} />
            <ReceiveRow label="Form 138 / Report Card" checked={docs.form138} onChange={() => toggleDoc('form138')} />
            <ReceiveRow label="Certificate of Good Moral Character" checked={docs.moral} onChange={() => toggleDoc('moral')} />
          </div>

          <div className="reg-actions">
            <button className="reg-btn reg-btn-blue" onClick={handleCreate}>Create Account</button>
            <button className="reg-btn reg-btn-plain" onClick={() => navigate('/registrar')}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <div className="reg-card">
            <p className="reg-card-title">Search by Learner Reference Number (LRN)</p>
            <p className="reg-help">Check the student ID on the Form 137 of the student.</p>
            <Field label="LRN">
              <input
                className="reg-input reg-input-narrow"
                value={lrn}
                onChange={(e) => setLrn(e.target.value)}
                placeholder="e.g. 136482850173"
              />
            </Field>
            <button className="reg-btn reg-btn-plain" onClick={handleSearch}>Search</button>
          </div>

          {learner && (
            <>
              <div className="reg-card">
                <p className="reg-card-label">Record found</p>
                <div className="reg-record">
                  <div className="reg-item-name">{learner.name}</div>
                  <div className="reg-item-meta">
                    LRN {lrn.trim()} - Currently {learner.grade}, Section {learner.section} - {learner.schoolYear}
                  </div>
                </div>
                <p className="reg-help reg-help-top">
                  {nextGrade
                    ? <>Promoting to <strong>{nextGrade}</strong>. Guardian and student details will be carried over - only the updated documents are needed below.</>
                    : <>This learner is in the last grade level and cannot be promoted further.</>}
                </p>
              </div>

              {nextGrade && (
                <>
                  <div className="reg-card">
                    <p className="reg-card-label">Documents</p>
                    <p className="reg-help">Only Form 138 is required for promotion. Birth certificate and good moral are already on file.</p>
                    <ReceiveRow label="Form 138 / Report Card (SY 2025-2026)" checked={form138} onChange={() => setForm138((v) => !v)} />
                    <div className="reg-receive">
                      <span>Birth Certificate <span className="reg-muted-small">Already on file</span></span>
                      <span className="reg-badge reg-badge-approved">Received</span>
                    </div>
                  </div>

                  <div className="reg-actions">
                    <button className="reg-btn reg-btn-blue" onClick={handleSubmitOld}>Submit Application</button>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="reg-field">
      <label>{label}</label>
      {children}
    </div>
  );
}

function ReceiveRow({ label, checked, onChange }) {
  return (
    <label className="reg-receive">
      <span>{label}</span>
      <span className={`reg-receive-status ${checked ? 'on' : ''}`}>
        <input type="checkbox" checked={checked} onChange={onChange} />
        {checked ? 'RECEIVED' : 'NOT RECEIVED'}
      </span>
    </label>
  );
}