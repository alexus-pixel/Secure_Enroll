import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Brand } from '../components/AppNav';
import api from '../api/client';
import PasswordInput from '../components/PasswordInput';
import { VerifiedDialog } from '../components/VerifyEmailOverlay';
import { validatePassword, validateConfirmPassword } from '../utils/validators';

/**
 * What the link in the email opens.
 *
 * Two kinds of account arrive here. A parent who signed up themselves already
 * has a password, so the link only confirms the address and the page says so.
 * A parent enrolled at the front desk has no password anybody told them — the
 * link is how they choose one, which confirms the address at the same time.
 * Nothing is ever read aloud or written on a slip of paper.
 *
 * The link is inspected first, without being used up, because the page has to
 * know which of the two it is before it shows anything.
 */
export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  // checking | set-password | success | error
  const [status, setStatus] = useState(token ? 'checking' : 'error');
  const [message, setMessage] = useState(token ? '' : 'This verification link is missing its token.');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState({ next: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    api.get('/auth/verification-token', { params: { token } })
      .then(({ data }) => {
        if (!alive) return;
        if (data.alreadyVerified) {
          setStatus('success');
          setMessage(data.message);
          return;
        }
        setEmail(data.email || '');
        if (data.mustSetPassword) {
          setStatus('set-password');
          return;
        }
        // Nothing to choose: confirm the address and be done.
        api.get('/auth/verify-email', { params: { token } })
          .then((res) => {
            if (!alive) return;
            setStatus('success');
            setMessage(res.data.message || 'Your email address has been verified.');
          })
          .catch((err) => {
            if (!alive) return;
            setStatus('error');
            setMessage(err.response?.data?.message || 'This verification link is invalid or has expired.');
          });
      })
      .catch((err) => {
        if (!alive) return;
        setStatus('error');
        setMessage(err.response?.data?.message || 'This link is invalid or has expired.');
      });
    return () => { alive = false; };
  }, [token]);

  async function handleSetPassword(e) {
    e.preventDefault();
    const found = {
      next: validatePassword(pw.next),
      confirm: validateConfirmPassword(pw.next, pw.confirm),
    };
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;

    setSaving(true);
    try {
      const { data } = await api.post('/auth/verify-email', { token, password: pw.next });
      setStatus('success');
      setMessage(data.message || 'Your password is set. You can now sign in.');
    } catch (err) {
      const text = err.response?.data?.message || 'We could not set your password. Please try again.';
      // An expired link cannot be retried from this page.
      if (err.response?.status === 400 && /invalid or has expired/i.test(text)) {
        setStatus('error');
        setMessage(text);
      } else {
        setErrors({ next: text });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-wrap">
      <aside className="auth-panel">
        <div>
          <Brand to="/" />
          <h2>{status === 'set-password' ? 'Set your password' : 'Verify your email'}</h2>
          <p>
            {status === 'set-password'
              ? 'Your child was enrolled at the school office. Choose a password here and this becomes your account for the parent portal.'
              : 'Confirming your email address keeps each enrollment application linked to a real, reachable parent or guardian.'}
          </p>
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
              <h1>Checking your link&hellip;</h1>
              <p className="sub">One moment.</p>
            </>
          )}

          {status === 'set-password' && (
            <form onSubmit={handleSetPassword} noValidate>
              <h1>Choose your password</h1>
              <p className="sub">
                You will sign in with <b>{email}</b>. Setting a password also confirms this address
                is yours, so there is nothing else to do afterwards.
              </p>
              <PasswordInput
                id="newPassword" label="New password" value={pw.next}
                onChange={(e) => setPw({ ...pw, next: e.target.value })}
                error={errors.next} autoComplete="new-password" showRules
              />
              <PasswordInput
                id="confirmPassword" label="Confirm password" value={pw.confirm}
                onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                error={errors.confirm} autoComplete="new-password"
              />
              <button className="btn btn-primary" type="submit" disabled={saving}
                style={{ width: '100%', marginTop: 8 }}>
                {saving ? 'Saving…' : 'Set password and continue'}
              </button>
            </form>
          )}

          {status === 'success' && (
            <>
              <h1>You are all set</h1>
              <div className="alert alert-ok">{message}</div>
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
                Please <Link to="/login">sign in</Link> to receive a new link, or use
                {' '}<Link to="/forgot-password">Forgot password</Link> if you have never set one.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
