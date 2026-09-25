const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
  findRoleIdByName, findUserByEmail, findUserById, createUser, updateUserPassword,
} = require('../db/users');
const { createGuardianProfile, getGuardianProfile, updateGuardianProfile } = require('../db/guardians');
const { isValidEmail, isValidName, isValidContactNumber, passwordIssues } = require('../utils/validators');
const { checkEmailDomain } = require('../utils/emailDomain');
const { issueToken, findValidToken, consumeToken } = require('../db/authTokens');
const { sendMail, verificationEmail, passwordResetEmail } = require('../utils/mailer');
const pool = require('../db/pool');

async function logAudit(userId, action, req) {
  await pool.query(
    `INSERT INTO audit_logs (user_id, action, ip_address, user_agent)
     VALUES ($1, $2, $3, $4)`,
    [userId, action, req.ip, req.get('user-agent')]
  );
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role_name,
    firstName: row.first_name || null,
    middleName: row.middle_name || null,
    lastName: row.last_name || null,
    emailVerified: Boolean(row.email_verified_at),
  };
}

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

async function sendVerificationEmail(userId, email) {
  // Never let a mail-provider hiccup fail the caller's request -- log it
  // and let the user retry via "resend verification email" instead.
  try {
    const token = await issueToken(userId, 'email_verify', EMAIL_VERIFY_TTL_MS);
    const { subject, text, html } = verificationEmail(token);
    await sendMail({ to: email, subject, text, html });
  } catch (err) {
    console.error('Could not send verification email:', err);
  }
}

async function register(req, res) {
  const client = await pool.connect();
  try {
    const {
      email, password, firstName, middleName, lastName, contactNumber,
    } = req.body;

    const problems = [];
    if (!isValidEmail(email)) problems.push('A valid email address is required.');
    if (!isValidName(firstName)) problems.push('First name is required and should contain letters only.');
    if (!isValidName(lastName)) problems.push('Last name is required and should contain letters only.');
    if (!isValidName(middleName, { required: false })) problems.push('M.I. should contain letters only.');
    if (!isValidContactNumber(contactNumber)) problems.push('Contact number must be an 11-digit mobile number (e.g. 09171234567).');
    const pwIssues = passwordIssues(password);
    if (pwIssues.length) problems.push(`Password needs ${pwIssues.join(', ')}.`);

    if (problems.length) {
      return res.status(400).json({ message: problems[0], errors: problems });
    }

    const domainCheck = await checkEmailDomain(email);
    if (!domainCheck.ok) {
      return res.status(400).json({ message: domainCheck.reason });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await findUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ message: 'An account with that email already exists.' });
    }

    const roleId = await findRoleIdByName('parent'); // public sign-up is always a parent
    const passwordHash = await bcrypt.hash(password, 12);

    await client.query('BEGIN');
    const user = await createUser({ email: normalizedEmail, passwordHash, roleId });
    await createGuardianProfile(client, {
      userId: user.id,
      firstName: firstName.trim(),
      middleName: middleName ? middleName.trim() : null,
      lastName: lastName.trim(),
      contactNumber: contactNumber.trim(),
    });
    await client.query('COMMIT');

    await logAudit(user.id, 'REGISTER', req);
    await sendVerificationEmail(user.id, user.email);
    res.status(201).json({ id: user.id, email: user.email });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ message: 'Registration failed.' });
  } finally {
    client.release();
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    const user = await findUserByEmail((email || '').toLowerCase().trim());

    // Same error whether the email doesn't exist or the password is wrong —
    // don't tell an attacker which one they got right.
    const genericError = () => res.status(401).json({ message: 'Invalid email or password.' });

    if (!user) return genericError();

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(423).json({ message: 'Account temporarily locked. Try again later.' });
    }

    const match = await bcrypt.compare(password || '', user.password_hash);
    if (!match) {
      await pool.query(
        `UPDATE users SET failed_login_attempts = failed_login_attempts + 1,
         locked_until = CASE WHEN failed_login_attempts + 1 >= 5
                              THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END
         WHERE id = $1`,
        [user.id]
      );
      await logAudit(user.id, 'LOGIN_FAILED', req);
      return genericError();
    }

    if (!user.is_active) {
      return res.status(403).json({ message: 'This account has been disabled.' });
    }

    await pool.query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL,
       last_login_at = NOW() WHERE id = $1`,
      [user.id]
    );

    const token = jwt.sign(
      { sub: user.id, role: user.role_name },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    // A second lookup keeps the login query above lean (it runs on every
    // attempt, including failed ones) while still returning the name the
    // UI needs for "Welcome, {firstName}!" right after signing in.
    const full = await findUserById(user.id);

    await logAudit(user.id, 'LOGIN_SUCCESS', req);
    res.json({ token, user: publicUser(full) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Login failed.' });
  }
}

async function getMe(req, res) {
  try {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Account not found.' });
    res.json(publicUser(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load your account.' });
  }
}

async function updateProfile(req, res) {
  try {
    const { firstName, middleName, lastName } = req.body;

    const problems = [];
    if (!isValidName(firstName)) problems.push('First name is required and should contain letters only.');
    if (!isValidName(lastName)) problems.push('Last name is required and should contain letters only.');
    if (!isValidName(middleName, { required: false })) problems.push('M.I. should contain letters only.');
    if (problems.length) return res.status(400).json({ message: problems[0], errors: problems });

    const updated = await updateGuardianProfile(pool, req.user.id, {
      firstName: firstName.trim(),
      middleName: middleName ? middleName.trim() : null,
      lastName: lastName.trim(),
    });
    if (!updated) return res.status(404).json({ message: 'Profile not found.' });

    await logAudit(req.user.id, 'PROFILE_UPDATED', req);
    res.json({
      firstName: updated.first_name, middleName: updated.middle_name, lastName: updated.last_name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not update your profile.' });
  }
}

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required.' });
    }

    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Account not found.' });

    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) {
      await logAudit(req.user.id, 'PASSWORD_CHANGE_FAILED', req);
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }

    const issues = passwordIssues(newPassword);
    if (issues.length) {
      return res.status(400).json({ message: `New password needs ${issues.join(', ')}.` });
    }
    if (await bcrypt.compare(newPassword, user.password_hash)) {
      return res.status(400).json({ message: 'New password must be different from your current password.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await updateUserPassword(req.user.id, passwordHash);

    await logAudit(req.user.id, 'PASSWORD_CHANGED', req);
    res.json({ message: 'Password updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not update your password.' });
  }
}

async function checkEmail(req, res) {
  try {
    const email = (req.query.email || '').toString();

    if (!isValidEmail(email)) {
      return res.json({ valid: false, reason: 'Enter a valid email address.' });
    }

    const domainCheck = await checkEmailDomain(email);
    if (!domainCheck.ok) {
      return res.json({ valid: false, reason: domainCheck.reason });
    }

    const existing = await findUserByEmail(email.toLowerCase().trim());
    if (existing) {
      return res.json({ valid: false, reason: 'An account with that email already exists.' });
    }

    res.json({ valid: true });
  } catch (err) {
    console.error(err);
    // Fail open: if OUR check breaks (DNS resolver unreachable, etc.) that's
    // not evidence the user's address is fake. register() re-validates
    // everything from scratch anyway, so nothing bad slips through.
    res.json({ valid: true });
  }
}

async function verifyEmail(req, res) {
  try {
    const token = (req.query.token || '').toString();
    const row = await findValidToken(token, 'email_verify');
    if (!row) {
      return res.status(400).json({ message: 'This verification link is invalid or has expired.' });
    }

    await pool.query(
      `UPDATE users SET email_verified_at = NOW() WHERE id = $1 AND email_verified_at IS NULL`,
      [row.user_id]
    );
    await consumeToken(row.id);
    await logAudit(row.user_id, 'EMAIL_VERIFIED', req);
    res.json({ message: 'Email verified. You can now log in.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not verify your email.' });
  }
}

async function resendVerification(req, res) {
  try {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Account not found.' });
    if (user.email_verified_at) {
      return res.json({ message: 'Your email is already verified.' });
    }

    await sendVerificationEmail(user.id, user.email);
    res.json({ message: 'Verification email sent.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not resend the verification email.' });
  }
}

async function forgotPassword(req, res) {
  // Always the same response, whether or not the account exists -- this
  // endpoint must never become a way to check which emails are registered.
  const generic = () => res.json({ message: 'If an account exists for that email, a reset link has been sent.' });

  try {
    const { email } = req.body;
    if (!isValidEmail(email)) return generic();

    const user = await findUserByEmail(email.toLowerCase().trim());
    if (!user) return generic();

    const token = await issueToken(user.id, 'password_reset', PASSWORD_RESET_TTL_MS);
    const { subject, text, html } = passwordResetEmail(token);
    await sendMail({ to: user.email, subject, text, html });
    await logAudit(user.id, 'PASSWORD_RESET_REQUESTED', req);
    generic();
  } catch (err) {
    console.error(err);
    generic();
  }
}

async function resetPassword(req, res) {
  try {
    const { token, newPassword } = req.body;
    const row = await findValidToken(token, 'password_reset');
    if (!row) {
      return res.status(400).json({ message: 'This reset link is invalid or has expired.' });
    }

    const issues = passwordIssues(newPassword);
    if (issues.length) {
      return res.status(400).json({ message: `Password needs ${issues.join(', ')}.` });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await updateUserPassword(row.user_id, passwordHash);
    await consumeToken(row.id);
    // A completed reset is a good moment to also clear any brute-force
    // lockout, since the person has just proven account ownership another way.
    await pool.query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
      [row.user_id]
    );

    await logAudit(row.user_id, 'PASSWORD_RESET_COMPLETED', req);
    res.json({ message: 'Password updated. You can now log in.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not reset your password.' });
  }
}

module.exports = {
  register, login, getMe, updateProfile, changePassword, checkEmail,
  verifyEmail, resendVerification, forgotPassword, resetPassword,
};
