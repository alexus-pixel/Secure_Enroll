import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/client';
import { Brand } from '../components/AppNav';
import PasswordInput from '../components/PasswordInput';
import {
  validateName, validateEmail, validateContactNumber, validatePassword, validateConfirmPassword,
} from '../utils/validators';

const FIELDS = ['lastName', 'firstName', 'middleName', 'email', 'contactNumber', 'password', 'confirmPassword'];

function validateField(name, form) {
  switch (name) {
    case 'lastName': return validateName(form.lastName, { label: 'Last name' });
    case 'firstName': return validateName(form.firstName, { label: 'First name' });
    case 'middleName': return validateName(form.middleName, { required: false, label: 'M.I.' });
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
  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const update = (field) => (e) => {
    const next = { ...form, [field]: e.target.value };
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

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');

    const nextErrors = {};
    FIELDS.forEach((f) => { nextErrors[f] = validateField(f, form); });
    setErrors(nextErrors);
    setTouched(Object.fromEntries(FIELDS.map((f) => [f, true])));
    if (Object.values(nextErrors).some(Boolean)) return;

    setSubmitting(true);
    try {
      await api.post('/auth/register', {
        email: form.email.trim(),
        password: form.password,
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim(),
        lastName: form.lastName.trim(),
        contactNumber: form.contactNumber.trim(),
      });
      navigate('/', { state: { registered: true } });
    } catch (err) {
      setFormError(err.response?.data?.message || 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-wrap">
      <aside className="auth-panel">
        <div>
          <Brand />
          <h2>Create your Parent Account</h2>
          <p>One account lets you enroll each of your children and track every application.</p>
        </div>
        <div className="auth-foot">
          This system is full of dummy data and all the information is only made up for
          demonstration purposes.
        </div>
      </aside>

      <main className="auth-main">
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <h1>Create Account</h1>
          <p className="sub">For parents and guardians enrolling a child.</p>
          {formError && <div className="alert alert-error">{formError}</div>}

          <div className="full-name-box">
            <p className="section-label">Full name</p>
            <div className="field-grid cols-3">
              <div>
                <label className="label" htmlFor="lastName">Last Name</label>
                <input id="lastName" className={`input${errors.lastName ? ' input-error' : ''}`}
                  value={form.lastName} onChange={update('lastName')} onBlur={handleBlur('lastName')}
                  autoComplete="family-name" required />
                {errors.lastName && <p className="field-error">{errors.lastName}</p>}
              </div>
              <div>
                <label className="label" htmlFor="firstName">First Name</label>
                <input id="firstName" className={`input${errors.firstName ? ' input-error' : ''}`}
                  value={form.firstName} onChange={update('firstName')} onBlur={handleBlur('firstName')}
                  autoComplete="given-name" required />
                {errors.firstName && <p className="field-error">{errors.firstName}</p>}
              </div>
              <div>
                <label className="label" htmlFor="middleName">M.I</label>
                <input id="middleName" className={`input${errors.middleName ? ' input-error' : ''}`}
                  value={form.middleName} onChange={update('middleName')} onBlur={handleBlur('middleName')}
                  autoComplete="additional-name" maxLength={4} />
                {errors.middleName && <p className="field-error">{errors.middleName}</p>}
              </div>
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="email">Email Address</label>
            <input id="email" className={`input${errors.email ? ' input-error' : ''}`} type="email"
              value={form.email} onChange={update('email')} onBlur={handleBlur('email')}
              autoComplete="email" required />
            {errors.email && <p className="field-error">{errors.email}</p>}
          </div>

          <div className="field">
            <label className="label" htmlFor="contactNumber">Contact/Phone Number</label>
            <input id="contactNumber" className={`input${errors.contactNumber ? ' input-error' : ''}`}
              value={form.contactNumber} onChange={update('contactNumber')} onBlur={handleBlur('contactNumber')}
              placeholder="09171234567" autoComplete="tel" required />
            {errors.contactNumber && <p className="field-error">{errors.contactNumber}</p>}
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

          <button className="btn btn-primary" style={{ width: '100%' }} type="submit" disabled={submitting}>
            {submitting ? 'Creating account\u2026' : 'Create Account'}
          </button>
          <p className="auth-alt">Already registered? <Link to="/">Log in</Link></p>
        </form>
      </main>
    </div>
  );
}
