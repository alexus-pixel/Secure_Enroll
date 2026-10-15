import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Brand } from '../components/AppNav';
import api from '../api/client';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState(token ? 'checking' : 'error'); // checking | success | error
  const [message, setMessage] = useState(token ? '' : 'This verification link is missing its token.');

  useEffect(() => {
    if (!token) return;
    api.get('/auth/verify-email', { params: { token } })
      .then(({ data }) => {
        setStatus('success');
        setMessage(data.message || 'Email verified.');
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err.response?.data?.message || 'This verification link is invalid or has expired.');
      });
  }, [token]);

  return (
    <div className="auth-wrap">
      <aside className="auth-panel">
        <div>
          <Brand />
          <h2>Verify your email</h2>
          <p>Confirming your address keeps enrollment applications tied to a real, reachable parent or guardian.</p>
        </div>
        <div className="auth-foot">
          This system is full of dummy data and all the information is only made up for
          demonstration purposes.
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-form">
          {status === 'checking' && (
            <>
              <h1>Verifying&hellip;</h1>
              <p className="sub">One moment while we confirm your link.</p>
            </>
          )}
          {status === 'success' && (
            <>
              <h1>Email verified</h1>
              <div className="alert alert-note">{message}</div>
              <Link className="btn btn-primary" style={{ width: '100%', textAlign: 'center', display: 'block' }} to="/">
                Go to sign in
              </Link>
            </>
          )}
          {status === 'error' && (
            <>
              <h1>Link didn&rsquo;t work</h1>
              <div className="alert alert-error">{message}</div>
              <p className="auth-alt">
                <Link to="/">Log in</Link> and resend the verification email from Account Settings.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
