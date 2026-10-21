import { useState } from 'react';
import PasswordInput from '../../components/PasswordInput';
import { checkStaffEmail } from '../../api/admin';
import ConfirmDialog from '../../components/ConfirmDialog';
import {
  validatePassword, validateEmail, validateName, validateInitial, NAME_MAX, INITIAL_MAX,
} from '../../utils/validators';

const ROLE_LABELS = { registrar: 'Registrar', admin: 'Administrator' };

// Only these two roles can be created here. A parent registers for themselves,
// and a teacher is a staff record under Teachers, not a login.
const CREATABLE_ROLES = ['registrar', 'admin'];

/**
 * Adds one staff account. There is no edit mode: an administrator cannot
 * change another account's role or password (see UsersPage).
 *
 * The password typed here is temporary. The account is made to replace it
 * the first time it signs in, which the server enforces — see
 * middleware/auth.js and users.must_change_password.
 */
export default function UserFormModal({ roles, onClose, onSubmit }) {
  const staffRoles = roles.filter((r) => CREATABLE_ROLES.includes(r.name));
  // The name is kept in three boxes, the same three the person will see in
  // their own Edit Profile, so nothing has to be guessed by splitting a
  // typed-in full name on its spaces.
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    middleInitial: '',
    email: '',
    password: '',
    roleId: staffRoles[0]?.id || '',
  });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // idle | checking | taken — whether this address is already somebody's
  // account. Asked when the box is left, not on every keystroke.
  const [emailState, setEmailState] = useState('idle');

  async function handleEmailBlur() {
    const problem = validateEmail(form.email);
    if (problem) { setFieldErrors((prev) => ({ ...prev, email: problem })); return; }
    setEmailState('checking');
    try {
      const { available, reason } = await checkStaffEmail(form.email.trim());
      setFieldErrors((prev) => ({ ...prev, email: available ? '' : reason }));
      setEmailState(available ? 'idle' : 'taken');
    } catch {
      // A hiccup here should not block the form; create re-checks anyway.
      setEmailState('idle');
    }
  }

  // Checked as it is typed, the same rules the server applies.
  const problems = (f) => ({
    firstName: validateName(f.firstName, { label: 'First name' }),
    lastName: validateName(f.lastName, { label: 'Last name' }),
    middleInitial: validateInitial(f.middleInitial),
    email: validateEmail(f.email),
    password: validatePassword(f.password),
  });

  const set = (field) => (e) => {
    const next = { ...form, [field]: e.target.value };
    setForm(next);
    const found = problems(next)[field];
    const stillEmpty = !String(next[field] || '').trim();
    setFieldErrors((prev) => ({ ...prev, [field]: stillEmpty ? '' : found }));
  };

  // Creating an account is worth a second look, so the form asks first.
  function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const found = problems(form);
    setFieldErrors(found);
    if (Object.values(found).some(Boolean)) {
      setError('Please correct the highlighted fields.');
      return;
    }
    if (emailState === 'taken') {
      setError('That email address already belongs to an account. Use a different one.');
      return;
    }
    setConfirming(true);
  }

  async function createAccount() {
    setSaving(true);
    try {
      await onSubmit(form);
      setConfirming(false);
    } catch (err) {
      const data = err.response?.data;
      setError(data?.errors?.map((x) => x.message).join(' ') || data?.message || 'Something went wrong.');
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  const roleName = staffRoles.find((r) => r.id === Number(form.roleId))?.name;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add user">
        <div className="modal-head">
          <div>
            <h2 style={{ marginBottom: 2 }}>Add User</h2>
            <p className="muted" style={{ fontSize: 14, margin: 0 }}>Registrar and administrator accounts only.</p>
          </div>
          <button className="btn-ghost" onClick={onClose} type="button">Close</button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} noValidate>
          <div className="field-grid cols-3">
            <div>
              <label className="label" htmlFor="user_firstName">First name</label>
              <input
                id="user_firstName" className={`input${fieldErrors.firstName ? ' input-error' : ''}`}
                value={form.firstName} onChange={set('firstName')} maxLength={NAME_MAX} required
              />
              {fieldErrors.firstName && <p className="field-error">{fieldErrors.firstName}</p>}
            </div>
            <div>
              <label className="label" htmlFor="user_lastName">Last name</label>
              <input
                id="user_lastName" className={`input${fieldErrors.lastName ? ' input-error' : ''}`}
                value={form.lastName} onChange={set('lastName')} maxLength={NAME_MAX} required
              />
              {fieldErrors.lastName && <p className="field-error">{fieldErrors.lastName}</p>}
            </div>
            <div>
              <label className="label" htmlFor="user_middleInitial">M.I. (optional)</label>
              <input
                id="user_middleInitial" className={`input${fieldErrors.middleInitial ? ' input-error' : ''}`}
                value={form.middleInitial} onChange={set('middleInitial')} maxLength={INITIAL_MAX}
              />
              {fieldErrors.middleInitial && <p className="field-error">{fieldErrors.middleInitial}</p>}
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="user_email">Email address</label>
            <input
              id="user_email" className={`input${fieldErrors.email ? ' input-error' : ''}`} type="email"
              placeholder="name@gmail.com"
              value={form.email} onChange={set('email')} onBlur={handleEmailBlur} required
            />
            {emailState === 'checking' && <p className="hint">Checking this address&hellip;</p>}
            {emailState !== 'checking' && fieldErrors.email && <p className="field-error">{fieldErrors.email}</p>}
          </div>

          <PasswordInput
            id="user_password"
            label="Temporary password"
            value={form.password}
            onChange={set('password')}
            error={fieldErrors.password}
            autoComplete="new-password"
            showRules
          />
          <p className="hint">
            Give this to them in person. They will be asked to choose their own password the first time
            they sign in, and cannot use the system until they do.
          </p>

          <div className="field">
            <label className="label" htmlFor="user_role">Role</label>
            <select
              id="user_role" className="input" value={form.roleId}
              onChange={(e) => setForm({ ...form, roleId: Number(e.target.value) })}
              required
            >
              {staffRoles.map((r) => <option key={r.id} value={r.id}>{ROLE_LABELS[r.name] || r.name}</option>)}
            </select>
          </div>

          <button className="btn btn-primary" type="submit" disabled={saving} style={{ width: '100%', marginTop: 8 }}>
            {saving ? 'Saving...' : 'Create account'}
          </button>
        </form>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Create this account?"
          confirmLabel="Create account"
          busy={saving}
          onConfirm={createAccount}
          onClose={() => setConfirming(false)}
        >
          <p>
            <b>{[form.firstName, form.middleInitial, form.lastName].filter(Boolean).join(' ')}</b>
            {roleName ? ` — ${roleName === 'admin' ? 'Administrator' : 'Registrar'}` : ''}
          </p>
          <p>{form.email}</p>
          <p>
            They sign in with the temporary password you entered and must replace it before they can use
            anything. The role cannot be changed afterwards.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
