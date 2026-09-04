import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/client';
import { Brand } from '../components/AppNav';

export default function Register() {
  const [form, setForm] = useState({ email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) return setError('Passwords do not match.');
    try {
      await api.post('/auth/register', { email: form.email, password: form.password });
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed.');
    }
  }

  return (
    <div className="auth-wrap">
      <aside className="auth-panel">
        <div>
          <Brand />
          <h2>Create your parent account</h2>
          <p>One account lets you enroll each of your children and track every application.</p>
        </div>
        <div className="auth-foot">University of Caloocan City &ndash; North Campus</div>
      </aside>

      <main className="auth-main">
        <form className="auth-form" onSubmit={handleSubmit}>
          <h1>Create account</h1>
          <p className="sub">For parents and guardians enrolling a child.</p>
          {error && <div className="alert alert-error">{error}</div>}

          <div className="field">
            <label className="label">Email address</label>
            <input className="input" type="email" value={form.email} onChange={update('email')} required />
          </div>
          <div className="field-grid cols-2">
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" value={form.password} onChange={update('password')} required />
            </div>
            <div>
              <label className="label">Confirm</label>
              <input className="input" type="password" value={form.confirmPassword} onChange={update('confirmPassword')} required />
            </div>
          </div>
          <p className="hint">At least 8 characters.</p>

          <button className="btn btn-primary" style={{ width: '100%' }} type="submit">Create Account</button>
          <p className="auth-alt">Already registered? <Link to="/">Log in</Link></p>
        </form>
      </main>
    </div>
  );
}