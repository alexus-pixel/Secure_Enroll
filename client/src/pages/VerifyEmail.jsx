import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Brand } from '../components/AppNav';
import api from '../api/client';
import { VerifiedDialog } from '../components/VerifyEmailOverlay';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const [status, setStatus] = useState(token ? 'checking' : 'error'); // checking | success | error
  const [message, setMessage] = useState(token ? '' : 'This verification link is missing its token.');

  useEffect(() => {
    if (!token) return;
    api.get('/auth/verify-email', { params: { token } })
      .then(({ data }) => {
        setStatus('success');
        setMessage(data.message || 'Your email address has been verified.');
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
          <Brand to="/" />
          <h2>Verify your email</h2>
          <p>Confirming your email address keeps each enrollment application linked to a real, reachable parent or guardian.</p>
        </div>
        <div className="auth-foot">
          This system contains only dummy data. All information is made up for
          demonstration purposes.
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-form">
          {status === 'checking' && (
            <>
              <h1>Verifying email&hellip;</h1>
              <p className="sub">One moment while we confirm your link.</p>
            </>
          )}
          {status === 'success' && (
            <>
              <h1>Email verified</h1>
              <div className="alert alert-note">{message}</div>
              <Link className="btn btn-primary" style={{ width: '100%', textAlign: 'center', display: 'block' }}
                to="/login" state={{ verified: true }}>
                Go to sign in
              </Link>
              <VerifiedDialog onContinue={() => navigate('/login', { state: { verified: true } })} />
            </>
          )}
          {status === 'error' && (
            <>
              <h1>This link did not work</h1>
              <div className="alert alert-error">{message}</div>
              <p className="auth-alt">
                Please <Link to="/login">sign in</Link> to receive a new verification email.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}