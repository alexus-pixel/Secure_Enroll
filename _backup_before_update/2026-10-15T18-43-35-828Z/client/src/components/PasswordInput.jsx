import { useState } from 'react';
import { passwordRules } from '../utils/validators';

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A11 11 0 0 1 12 5c7 0 11 7 11 7a13.7 13.7 0 0 1-3.2 3.9" />
      <path d="M6.5 6.6A13.9 13.9 0 0 0 1 12s4 7 11 7a10.4 10.4 0 0 0 4.2-.9" />
      <path d="M9.5 9.6a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

// showRules renders a live checklist under the field (used on the Register
// and Account Settings "new password" fields); leave it off for a plain
// login password field or a "confirm password" / "current password" field.
export default function PasswordInput({
  id, label, value, onChange, onBlur, placeholder, autoComplete = 'new-password',
  error, hint, showRules = false,
}) {
  const [visible, setVisible] = useState(false);
  const rules = showRules ? passwordRules(value) : null;

  return (
    <div className="field">
      {label && <label className="label" htmlFor={id}>{label}</label>}
      <div className="input-icon-wrap">
        <input
          id={id}
          className={`input${error ? ' input-error' : ''}`}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
        />
        <button
          type="button"
          className="input-icon-btn"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {error && <p className="field-error">{error}</p>}
      {!error && hint && <p className="hint">{hint}</p>}
      {rules && (
        <ul className="pw-rules">
          {rules.map((r) => (
            <li key={r.label} className={r.met ? 'met' : ''}>{r.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
