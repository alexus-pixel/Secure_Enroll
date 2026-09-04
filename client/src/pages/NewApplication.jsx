import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

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

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/applications', form);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Submission failed.');
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 480, margin: '40px auto' }}>
      <h1>New Enrollment Application</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}

      <h3>Student</h3>
      <input placeholder="First name" value={form.firstName} onChange={update('firstName')} required />
      <input placeholder="Middle name" value={form.middleName} onChange={update('middleName')} />
      <input placeholder="Last name" value={form.lastName} onChange={update('lastName')} required />
      <input type="date" value={form.birthDate} onChange={update('birthDate')} required />
      <select value={form.sex} onChange={update('sex')}>
        <option value="F">Female</option><option value="M">Male</option>
      </select>

      <h3>Guardian</h3>
      <input placeholder="Your first name" value={form.guardianFirstName} onChange={update('guardianFirstName')} required />
      <input placeholder="Your last name" value={form.guardianLastName} onChange={update('guardianLastName')} required />
      <select value={form.relationship} onChange={update('relationship')}>
        <option>Mother</option><option>Father</option><option>Guardian</option>
      </select>
      <input placeholder="Contact number" value={form.contactNumber} onChange={update('contactNumber')} required />
      <input placeholder="Address" value={form.address} onChange={update('address')} required />

      <h3>Grade Level</h3>
      <select value={form.gradeLevelId} onChange={update('gradeLevelId')}>
        {GRADE_LEVELS.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>

      <button type="submit">Submit Application</button>
    </form>
  );
}