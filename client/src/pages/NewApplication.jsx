import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import AppNav from '../components/AppNav';

const GRADE_LEVELS = [
  { id: 1, name: 'Kinder' }, { id: 2, name: 'Grade 1' }, { id: 3, name: 'Grade 2' },
  { id: 4, name: 'Grade 3' }, { id: 5, name: 'Grade 4' }, { id: 6, name: 'Grade 5' }, { id: 7, name: 'Grade 6' },
];

export default function NewApplication() {
  const [form, setForm] = useState({
    firstName: '', middleName: '', lastName: '', birthDate: '', sex: 'F',
    guardianFirstName: '', guardianMiddleName: '', guardianLastName: '',
    relationship: 'Mother', contactNumber: '', address: '',
    gradeLevelId: '1', schoolYearId: '1',
  });
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const [files, setFiles] = useState({ birth_certificate: null, form_138: null, good_moral: null });
  const pickFile = (docType) => (e) => setFiles({ ...files, [docType]: e.target.files[0] });

  async function handleSubmit(e) {
  e.preventDefault();
  setError('');
  try {
    const { data } = await api.post('/applications', form);
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

    return (
    <>
      <AppNav crumb="New Application" />
      <div className="container container-narrow">
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
                <input className="input" type="date" value={form.birthDate} onChange={update('birthDate')} required /></div>
              <div><label className="label">Sex</label>
                <select className="input" value={form.sex} onChange={update('sex')}>
                  <option value="F">Female</option><option value="M">Male</option>
                </select></div>
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
            <Link className="btn btn-secondary" to="/dashboard">Cancel</Link>
          </div>
        </form>
      </div>
    </>
  );
}