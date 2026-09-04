import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Brand } from '../components/AppNav';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed.');
    }
  }

  return (
    <div className="auth-wrap">
      <aside className="auth-panel">
        <div>
          <Brand />
          <h2>Enrollment for Caloocan City Elementary School</h2>
          <p>Encrypted student records. Role-based access for parents, registrars, and administrators.</p>
        </div>
        <div className="auth-foot">University of Caloocan City &ndash; North Campus</div>
      </aside>

      <main className="auth-main">
        <form className="auth-form" onSubmit={handleSubmit}>
          <h1>Sign in</h1>
          <p className="sub">Use the account your school registered for you.</p>
          {error && <div className="alert alert-error">{error}</div>}

          <div className="field">
            <label className="label">Email address</label>
            <input className="input" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="parent@example.com" required />
          </div>
          <div className="field">
            <label className="label">Password</label>
            <input className="input" type="password" value={password}
              onChange={(e) => setPassword(e.target.value)} required />
          </div>

          <button className="btn btn-primary" style={{ width: '100%' }} type="submit">Log In</button>
          <p className="auth-alt">New parent or guardian? <Link to="/register">Create an account</Link></p>
        </form>
      </main>
    </div>
  );
}