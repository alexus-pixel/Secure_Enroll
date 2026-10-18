import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/client';
import { Brand } from '../components/AppNav';
import PasswordInput from '../components/PasswordInput';
import {
  validateName, validateInitial, validateEmail, validateContactNumber, validatePassword, validateConfirmPassword, sanitizePhone, INITIAL_MAX,
} from '../utils/validators';
import VerifyEmailOverlay from '../components/VerifyEmailOverlay';
import { useScrollToError } from '../hooks/useScrollToError';

const FIELDS = ['lastName', 'firstName', 'middleName', 'email', 'contactNumber', 'password', 'confirmPassword'];

function validateField(name, form) {
  switch (name) {
    case 'lastName': return validateName(form.lastName, { label: 'Last name' });
    case 'firstName': return validateName(form.firstName, { label: 'First name' });
    case 'middleName': return validateInitial(form.middleName);
    case 'email': return validateEmail(form.email);
    case 'contactNumber': return validateContactNumber(form.contactNumber);
    case 'password': return validatePassword(form.password);
    case 'confirmPassword': return validateConfirmPassword(form.password, form.confirmPassword);
    default: return '';
  }
}

export default function Register() {
  const [form, setForm] = useState({
    lastName: '', firstName: '', middleName: '', email: '', contactNumber: '',
    password: '', confirmPassword: '',
  });
  // Data Privacy Act (RA 10173): the parent must agree before an account is made.
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState('');
  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState({});
  const [emailChecking, setEmailChecking] = useState(false);
  const [formError, setFormError] = useState('');
  useScrollToError(formError);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  // Set after sign-up succeeds: shows the "Verifying email" overlay.
  const [pending, setPending] = useState(null);

  const update = (field) => (e) => {
    const raw = field === 'contactNumber' ? sanitizePhone(e.target.value) : e.target.value;
    const next = { ...form, [field]: raw };
    setForm(next);
    // Once a field has been flagged, re-validate live as the user retypes it
    // instead of waiting for the next blur, so the message clears promptly.
    if (touched[field]) {
      setErrors((prev) => ({ ...prev, [field]: validateField(field, next) }));
    }
    if (field === 'password' && touched.confirmPassword) {
      setErrors((prev) => ({ ...prev, confirmPassword: validateConfirmPassword(next.password, next.confirmPassword) }));
    }
  };

  const handleBlur = (field) => () => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors((prev) => ({ ...prev, [field]: validateField(field, form) }));
  };

  // Email gets an extra async pass: the sync check above only confirms the
  // *shape* looks like an email. This confirms the domain can actually
  // receive mail (and isn't already registered) before the parent fills
  // out the rest of the form.
  const handleEmailBlur = async () => {
    setTouched((prev) => ({ ...prev, email: true }));
    const formatError = validateEmail(form.email);
    if (formatError) {
      setErrors((prev) => ({ ...prev, email: formatError }));
      return;
    }
    setEmailChecking(true);
    try {
      const { data } = await api.get('/auth/check-email', { params: { email: form.email.trim() } });
      setErrors((prev) => ({ ...prev, email: data.valid ? '' : data.reason }));
    } catch {
      // A network hiccup here shouldn't block the user -- register()
      // re-checks everything, authoritatively, on submit regardless.
      setErrors((prev) => ({ ...prev, email: '' }));
    } finally {
      setEmailChecking(false);
    }
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');

    const nextErrors = {};
    FIELDS.forEach((f) => { nextErrors[f] = validateField(f, form); });
    setErrors(nextErrors);
    setTouched(Object.fromEntries(FIELDS.map((f) => [f, true])));
    if (!consent) setConsentError('Please accept the Data Privacy Notice to continue.');
    if (Object.values(nextErrors).some(Boolean) || !consent) return;

    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/register', {
        email: form.email.trim(),
        password: form.password,
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim(),
        lastName: form.lastName.trim(),
        contactNumber: form.contactNumber.trim(),
        privacyConsent: true,
      });
      if (data.verificationTicket) {
        setPending({
          ticket: data.verificationTicket,
          emailSent: data.emailSent,
          retryAfter: data.retryAfter,
          email: form.email.trim(),
        });
      } else {
        navigate('/login', { state: { registered: true } });
      }
    } catch (err) {
      setFormError(err.response?.data?.message || 'Registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-wrap">
      <aside className="auth-panel">
        <div>
          <Brand to="/" />
          <h2>Create your Parent Account</h2>
          <p>One account lets you enroll each of your children and track every application.</p>
        </div>
        <div className="auth-foot">
          This system contains only dummy data. All information is made up for
          demonstration purposes.
        </div>
      </aside>

      <main className="auth-main">
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <h1>Create Account</h1>
          <p className="sub">For parents and guardians who are enrolling a child.</p>
          {formError && <div className="alert alert-error">{formError}</div>}

          <div className="full-name-box">
            <p className="section-label">Full name</p>
            <div className="field-grid cols-3">
              <div>
                <label className="label" htmlFor="lastName">Last Name</label>
                <input id="lastName" className={`input${errors.lastName ? ' input-error' : ''}`}
                  value={form.lastName} onChange={update('lastName')} onBlur={handleBlur('lastName')}
                  autoComplete="family-name" maxLength={60} required />
                {errors.lastName && <p className="field-error">{errors.lastName}</p>}
              </div>
              <div>
                <label className="label" htmlFor="firstName">First Name</label>
                <input id="firstName" className={`input${errors.firstName ? ' input-error' : ''}`}
                  value={form.firstName} onChange={update('firstName')} onBlur={handleBlur('firstName')}
                  autoComplete="given-name" maxLength={60} required />
                {errors.firstName && <p className="field-error">{errors.firstName}</p>}
              </div>
              <div>
                <label className="label" htmlFor="middleName">M.I. <span className="muted">(optional)</span></label>
                <input id="middleName" className={`input${errors.middleName ? ' input-error' : ''}`}
                  value={form.middleName} onChange={update('middleName')} onBlur={handleBlur('middleName')}
                  autoComplete="additional-name" maxLength={INITIAL_MAX} />
                {errors.middleName && <p className="field-error">{errors.middleName}</p>}
              </div>
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="email">Email Address</label>
            <input id="email" className={`input${errors.email ? ' input-error' : ''}`} type="email"
              value={form.email} onChange={update('email')} onBlur={handleEmailBlur}
              autoComplete="email" maxLength={254} required />
            {emailChecking && <p className="hint">Checking email&hellip;</p>}
            {!emailChecking && errors.email && <p className="field-error">{errors.email}</p>}
          </div>

          <div className="field">
            <label className="label" htmlFor="contactNumber">Contact/Phone Number</label>
            <input id="contactNumber" className={`input${errors.contactNumber ? ' input-error' : ''}`}
              value={form.contactNumber} onChange={update('contactNumber')} onBlur={handleBlur('contactNumber')}
              placeholder="09171234567" autoComplete="tel" inputMode="tel" maxLength={13} required />
            {errors.contactNumber ? <p className="field-error">{errors.contactNumber}</p>
              : <p className="hint">Use 09XXXXXXXXX (11 digits) or +63XXXXXXXXXX (13 characters).</p>}
          </div>

          <div className="field-grid cols-2">
            <PasswordInput
              id="password" label="Password" value={form.password}
              onChange={update('password')} onBlur={handleBlur('password')}
              error={errors.password} showRules
            />
            <PasswordInput
              id="confirmPassword" label="Confirm Password" value={form.confirmPassword}
              onChange={update('confirmPassword')} onBlur={handleBlur('confirmPassword')}
              error={errors.confirmPassword} hint={!errors.confirmPassword ? 'At least 8 characters.' : ''}
            />
          </div>

          <details className="privacy-notice">
            <summary>Read the Data Privacy Notice</summary>
            <p><b>Data Privacy Act of 2012 (RA 10173)</b></p>
            <ul>
              <li><b>What we collect:</b> your name, email and mobile number; your child&apos;s name, birth date, sex, LRN and address; and the documents you upload.</li>
              <li><b>Why:</b> only to process your child&apos;s enrollment at Caloocan City Elementary School.</li>
              <li><b>Who can see it:</b> school registrar staff and administrators. You can only see your own child&apos;s records.</li>
              <li><b>How it is protected:</b> sensitive details are encrypted, access depends on the user&apos;s role, and important actions are logged.</li>
              <li><b>How long we keep it:</b> only as long as needed for enrollment and school record rules. We do not share it with other parties unless the law requires it.</li>
              <li><b>Your rights:</b> you may ask to see or correct your data, or file a complaint with the National Privacy Commission.</li>
            </ul>
          </details>
          <label className="check-row" htmlFor="privacyConsent">
            <input
              id="privacyConsent" type="checkbox" checked={consent}
              onChange={(e) => { setConsent(e.target.checked); if (e.target.checked) setConsentError(''); }}
            />
            <span>I have read the Data Privacy Notice and I agree that the school may collect and use my information and my child&apos;s information for enrollment.</span>
          </label>
          {consentError && <p className="field-error" style={{ marginTop: -10, marginBottom: 14 }}>{consentError}</p>}

          <button className="btn btn-primary" style={{ width: '100%' }} type="submit" disabled={submitting}>
            {submitting ? 'Creating account\u2026' : 'Create Account'}
          </button>
          <p className="auth-alt">Already registered? <Link to="/login">Sign in</Link></p>
        </form>
      </main>

      {pending && (
        <VerifyEmailOverlay
          ticket={pending.ticket}
          email={pending.email}
          emailSent={pending.emailSent}
          retryAfter={pending.retryAfter}
          variant="register"
          onVerified={() => navigate('/login', { state: { verified: true } })}
          onClose={() => navigate('/login', { state: { registered: true } })}
        />
      )}
    </div>
  );
}