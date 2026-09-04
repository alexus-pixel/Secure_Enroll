import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/client';

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
    <form onSubmit={handleSubmit} style={{ maxWidth: 340, margin: '60px auto' }}>
      <h1>Create your account</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <input type="email" placeholder="Email" value={form.email} onChange={update('email')} required />
      <input type="password" placeholder="Password" value={form.password} onChange={update('password')} required />
      <input type="password" placeholder="Confirm password" value={form.confirmPassword} onChange={update('confirmPassword')} required />
      <button type="submit">Create Account</button>
      <p>Already registered? <Link to="/">Log in</Link></p>
    </form>
  );
}