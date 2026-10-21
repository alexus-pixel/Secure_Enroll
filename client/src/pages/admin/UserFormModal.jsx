import { useState } from 'react';
import { checkStaffEmail } from '../../api/admin';
import ConfirmDialog from '../../components/ConfirmDialog';
import {
  validateEmail, validateName, validateInitial, NAME_MAX, INITIAL_MAX,
} from '../../utils/validators';

const ROLE_LABELS = { registrar: 'Registrar', admin: 'Administrator' };

// Only these two roles can be created here. A parent registers for themselves,
// and a teacher is a staff record under Teachers, not a login.
const CREATABLE_ROLES = ['registrar', 'admin'];

/**
 * Adds one staff account. There is no edit mode: an administrator cannot
 * change another account's role or password (see UsersPage).
 *
 * No password is asked for or set here. The account is created without a
 * usable one and a verification link is emailed to the address; the person
 * chooses their own password from that link. That keeps an administrator from
 * ever knowing somebody else's password, and the email arriving is also the
 * only real proof the address exists — the same thing the walk-in parent flow
 * does. See usersController.create and VerifyEmail.jsx.
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
    roleId: staffRoles[0]?.id || '',
  });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // idle | checking | rejected — what the server said about this address.
  // Asked when the box is left, not on every keystroke. It answers two
  // separate questions: is the address already somebody's account, and can it
  // receive mail at all. Either one is a reason not to create the account, and
  // the server's own sentence says which it was, so it is shown as given
  // rather than flattened into one message.
  const [emailState, setEmailState] = useState('idle');
  const [emailProblem, setEmailProblem] = useState('');

  async function handleEmailBlur() {
    const problem = validateEmail(form.email);
    if (problem) { setFieldErrors((prev) => ({ ...prev, email: problem })); return; }
    setEmailState('checking');
    try {
      const { available, reason } = await checkStaffEmail(form.email.trim());
      const sentence = available ? '' : (reason || 'That address cannot be used.');
      setFieldErrors((prev) => ({ ...prev, email: sentence }));
      setEmailProblem(sentence);
      setEmailState(available ? 'idle' : 'rejected');
    } catch {
      // A hiccup here should not block the form; create re-checks anyway.
      setEmailState('idle');
      setEmailProblem('');
    }
  }

  // Checked as it is typed, the same rules the server applies.
  const problems = (f) => ({
    firstName: validateName(f.firstName, { label: 'First name' }),
    lastName: validateName(f.lastName, { label: 'Last name' }),
    middleInitial: validateInitial(f.middleInitial),
    email: validateEmail(f.email),
  });

  const set = (field) => (e) => {
    const next = { ...form, [field]: e.target.value };
    setForm(next);
    // A verdict belongs to the address it was asked about. Once the address is
    // being changed the old answer is no longer about anything, so it is
    // dropped and asked again when the box is left.
    if (field === 'email') { setEmailState('idle'); setEmailProblem(''); }
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
    if (emailState === 'rejected') {
      setError(emailProblem || 'That email address cannot be used. Use a different one.');
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
            {emailState === 'idle' && !fieldErrors.email && (
              <p className="hint">
                Checked when you leave this box: the address must not already belong to an account, and it
                must be one that can actually receive mail.
              </p>
            )}
          </div>

          {/* Said plainly, because the admin will be asked “so what is my
              password?” if it is not. */}
          <p className="hint">
            No password is set here. When this account is created, SecureEnroll emails a verification
            link to the address above, and the person chooses their own password from that link. They
            cannot sign in until they do.
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
            A verification link will be emailed to that address. They set their own password from the
            link, and cannot sign in before they do. The role cannot be changed afterwards.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
