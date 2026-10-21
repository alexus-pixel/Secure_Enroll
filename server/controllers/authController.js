const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
  findRoleIdByName, findUserByEmail, findUserById, createUser, updateUserPassword,
} = require('../db/users');
const { createGuardianProfile, getGuardianProfile, updateGuardianProfile } = require('../db/guardians');
const {
  isValidEmail, isValidName, isValidGmail, normalizeGmail, isValidContactNumber,
  passwordIssues, PASSWORD_MAX_BYTES, INITIAL_MAX, CONTACT_MESSAGE, GMAIL_MESSAGE,
} = require('../utils/validators');
const { sendDbError } = require('../utils/dbErrors');

const isText = (v) => typeof v === 'string';
const { checkEmailAcceptable } = require('../lib/emailGate');
const { issueToken, findValidToken, findTokenRecord, consumeToken } = require('../db/authTokens');
const {
  sendMail, sendVerificationMail, verificationEmail, passwordResetEmail, describeMailError,
} = require('../utils/mailer');
const pool = require('../db/pool');

async function logAudit(userId, action, req, details = null) {
  await pool.query(
    `INSERT INTO audit_logs (user_id, action, ip_address, user_agent, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, action, req.ip, req.get('user-agent'), details ? JSON.stringify(details) : null]
  );
}

// Version of the Data Privacy Notice shown on the sign-up page. Change it
// whenever the wording of the notice changes, so the audit log shows which
// text each parent agreed to.
const PRIVACY_NOTICE_VERSION = '2026-10';

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role_name,
    firstName: row.first_name || null,
    middleName: row.middle_name || null,
    lastName: row.last_name || null,
    emailVerified: Boolean(row.email_verified_at),
    // A staff account created by an administrator starts with a temporary
    // password and cannot do anything else until it has been replaced.
    mustChangePassword: Boolean(row.must_change_password),
  };
}

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------
// Email verification gate
//
// A parent cannot sign in until their email address is verified. When a
// sign-in is refused for that reason, the response carries a short-lived
// "ticket". The ticket proves the caller just entered the correct
// password, and it lets the page (a) poll whether the link has been
// clicked and (b) ask for another email, without needing a login token.
// It is signed with a DIFFERENT secret from login tokens, so it can never
// be used to call the rest of the API.
// ---------------------------------------------------------------------
const VERIFY_TICKET_TTL = '30m';
const RESEND_COOLDOWN_SECONDS = 60;

const ticketSecret = () => `${process.env.JWT_SECRET}:email-verify-ticket`;

function signVerificationTicket(userId) {
  return jwt.sign({ sub: String(userId), purpose: 'email-verify-wait' }, ticketSecret(), {
    expiresIn: VERIFY_TICKET_TTL,
  });
}

function readVerificationTicket(ticket) {
  try {
    const payload = jwt.verify(String(ticket || ''), ticketSecret());
    return payload.purpose === 'email-verify-wait' ? payload.sub : null;
  } catch {
    return null;
  }
}

// Only parents sign up on their own, so only parents must verify. Staff
// accounts are created by an administrator, and old walk-in placeholder
// addresses (@walkin.invalid) cannot receive mail at all.
function requiresEmailVerification(user) {
  return user.role_name === 'parent'
    && !user.email_verified_at
    && !/@walkin\.invalid$/i.test(user.email || '');
}

// When a verification email last went out successfully, per user. Used
// only to space out requests, so keeping it in memory is enough.
const lastVerificationSent = new Map();

function secondsUntilResend(userId) {
  const last = lastVerificationSent.get(String(userId));
  if (!last) return 0;
  const left = RESEND_COOLDOWN_SECONDS * 1000 - (Date.now() - last);
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

// Returns { ok } instead of hiding the outcome: callers must be able to
// tell the user whether the email really went out.
async function sendVerificationEmail(userId, email, { setPassword = false } = {}) {
  try {
    const token = await issueToken(userId, 'email_verify', EMAIL_VERIFY_TTL_MS);
    // Greet the parent by first name when we have it (best effort only).
    const nameRow = await pool.query('SELECT first_name FROM guardians WHERE user_id = $1', [userId]).catch(() => null);
    const { subject, text, html } = verificationEmail(token, nameRow?.rows[0]?.first_name, { setPassword });
    await sendVerificationMail({ to: email, subject, text, html });
    lastVerificationSent.set(String(userId), Date.now());
    return { ok: true };
  } catch (err) {
    console.error('Could not send verification email:', err.message || err);
    console.error('  Fix:', describeMailError(err));
    return { ok: false };
  }
}

// Sends a verification email unless one went out in the last minute.
async function ensureVerificationEmail(user) {
  const wait = secondsUntilResend(user.id);
  if (wait > 0) return { ok: true, retryAfter: wait };
  const result = await sendVerificationEmail(user.id, user.email);
  return { ok: result.ok, retryAfter: result.ok ? RESEND_COOLDOWN_SECONDS : 0 };
}

// Shared by both resend endpoints. Answers honestly: 429 while the
// cooldown runs, 502 if the mail provider failed, 200 only if it was sent.
async function resendFor(user, res) {
  if (user.email_verified_at) {
    return res.json({ verified: true, message: 'Your email address is already verified.' });
  }
  const wait = secondsUntilResend(user.id);
  if (wait > 0) {
    return res.status(429).json({
      message: `Please wait ${wait} second${wait === 1 ? '' : 's'} before requesting another email.`,
      retryAfter: wait,
    });
  }
  const result = await sendVerificationEmail(user.id, user.email);
  if (!result.ok) {
    return res.status(502).json({
      message: 'We could not send the verification email right now. Please try again in a few minutes.',
    });
  }
  return res.json({
    message: 'Verification email sent. Please check your inbox and your spam folder.',
    retryAfter: RESEND_COOLDOWN_SECONDS,
  });
}

async function register(req, res) {
  const client = await pool.connect();
  try {
    const {
      email, confirmEmail, password, firstName, middleName, lastName, contactNumber, privacyConsent,
    // A request with no body, or one that is not JSON, arrives as undefined.
    } = req.body || {};

    const problems = [];
    // Data Privacy Act (RA 10173): the parent must agree before we collect data.
    if (privacyConsent !== true) problems.push('Please read and accept the Data Privacy Notice to create an account.');
    // A parent signs in with their own Gmail. Staff accounts are made in User
    // Management and are not restricted this way.
    if (!isValidGmail(email)) problems.push(GMAIL_MESSAGE);
    else if (confirmEmail !== undefined && normalizeGmail(confirmEmail) !== normalizeGmail(email)) {
      problems.push('The two Gmail addresses do not match.');
    }
    if (!isValidName(firstName)) problems.push('First name is required and should contain letters only.');
    if (!isValidName(lastName)) problems.push('Last name is required and should contain letters only.');
    // An initial is one letter, so the 2-character minimum for names is wrong here.
    if (!isValidName(middleName, { required: false, min: 1, max: INITIAL_MAX })) problems.push(`M.I. should contain letters only (up to ${INITIAL_MAX} characters).`);
    if (!isValidContactNumber(contactNumber)) problems.push(CONTACT_MESSAGE);
    const pwIssues = passwordIssues(password);
    if (pwIssues.length) problems.push(`Password needs ${pwIssues.join(', ')}.`);

    if (problems.length) {
      return res.status(400).json({ message: problems[0], errors: problems });
    }

    // The same gate the front desk uses: the domain is one the school's mail
    // service reaches, the mailbox is not known to be dead, and Brevo is not
    // already refusing it (lib/emailGate.js). An account on an address nobody
    // can receive mail at is an account nobody can ever open.
    const gate = await checkEmailAcceptable(email, { requireGmail: true });
    if (!gate.ok) {
      return res.status(400).json({ message: gate.reason });
    }

    const normalizedEmail = normalizeGmail(email);
    const existing = await findUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ message: 'An account with that email address already exists.' });
    }

    const roleId = await findRoleIdByName('parent'); // public sign-up is always a parent
    const passwordHash = await bcrypt.hash(password, 12);

    await client.query('BEGIN');
    const user = await createUser({ email: normalizedEmail, passwordHash, roleId });
    await client.query(
      'UPDATE users SET first_name = $2, middle_initial = $3, last_name = $4 WHERE id = $1',
      [user.id, firstName.trim(), middleName ? middleName.trim() : null, lastName.trim()]
    ).catch(() => {}); // column added by ensureSchema; never block sign-up
    await createGuardianProfile(client, {
      userId: user.id,
      firstName: firstName.trim(),
      middleName: middleName ? middleName.trim() : null,
      lastName: lastName.trim(),
      contactNumber: contactNumber.trim(),
    });
    await client.query('COMMIT');

    await logAudit(user.id, 'REGISTER', req);
    await logAudit(user.id, 'PRIVACY_CONSENT_GIVEN', req, { noticeVersion: PRIVACY_NOTICE_VERSION });
    const mail = await ensureVerificationEmail(user);
    res.status(201).json({
      id: user.id,
      email: user.email,
      emailSent: mail.ok,
      retryAfter: mail.retryAfter,
      verificationTicket: signVerificationTicket(user.id),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (sendDbError(err, res)) return;
    if (err.code === '23505') {
      return res.status(409).json({ message: 'An account with that email address already exists.' });
    }
    console.error(err);
    res.status(500).json({ message: 'Registration failed. Please try again.' });
  } finally {
    client.release();
  }
}

/* ---------------------------------------------------------------------------
 * Brute-force lockout.
 *
 * Three wrong passwords lock the account. The first lock lasts a minute and
 * each further one is a minute longer — 1, 2, 3, 4, then 5 minutes, which is
 * as long as it gets. A person who mistyped waits a moment; a script gets
 * nowhere, because every three guesses costs it another five minutes.
 *
 * A clean day resets the count, and so does a successful sign-in, so an
 * ordinary user never carries yesterday's mistakes.
 * ------------------------------------------------------------------------- */
const FAILED_ATTEMPTS_BEFORE_LOCK = 3;
const FIRST_LOCK_MINUTES = 1;
const MAX_LOCK_MINUTES = 5;
const ATTEMPT_MEMORY_HOURS = 24;

function lockMinutesFor(lockoutNumber) {
  return Math.min(FIRST_LOCK_MINUTES + Math.max(0, lockoutNumber - 1), MAX_LOCK_MINUTES);
}

async function registerFailedLogin(user) {
  const lastFailed = user.last_failed_login_at ? new Date(user.last_failed_login_at) : null;
  const stale = !lastFailed || (Date.now() - lastFailed.getTime()) > ATTEMPT_MEMORY_HOURS * 3600 * 1000;
  const attempts = (stale ? 0 : Number(user.failed_login_attempts) || 0) + 1;

  if (attempts < FAILED_ATTEMPTS_BEFORE_LOCK) {
    await pool.query(
      'UPDATE users SET failed_login_attempts = $2, last_failed_login_at = NOW() WHERE id = $1',
      [user.id, attempts]
    );
    return { locked: false, attemptsLeft: FAILED_ATTEMPTS_BEFORE_LOCK - attempts };
  }

  const lockoutNumber = (Number(user.lockout_count) || 0) + 1;
  const minutes = lockMinutesFor(lockoutNumber);
  const { rows: [row] } = await pool.query(
    `UPDATE users
     SET failed_login_attempts = 0,
         lockout_count = $2,
         last_failed_login_at = NOW(),
         locked_until = NOW() + ($3 || ' minutes')::interval
     WHERE id = $1
     RETURNING locked_until`,
    [user.id, lockoutNumber, String(minutes)]
  );
  return { locked: true, minutes, attemptsLeft: 0, lockedUntil: row ? new Date(row.locked_until).toISOString() : null };
}

async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    // Wrong types (objects, arrays, numbers) or absurdly long values never reach
    // the database or bcrypt.
    if (!isText(email) || !isText(password) || !email.trim() || !password
        || email.length > 254 || Buffer.byteLength(password) > PASSWORD_MAX_BYTES) {
      return res.status(400).json({ message: 'Enter your email address and password.' });
    }
    const user = await findUserByEmail(email.toLowerCase().trim());

    // Same error whether the email doesn't exist or the password is wrong —
    // don't tell an attacker which one they got right.
    const genericError = () => res.status(401).json({ message: 'Invalid email or password.' });

    if (!user) return genericError();

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const seconds = Math.max(1, Math.ceil((new Date(user.locked_until) - Date.now()) / 1000));
      return res.status(423).json({
        message: 'Too many failed sign-in attempts. This account is locked.',
        retryAfter: seconds,
        lockedUntil: new Date(user.locked_until).toISOString(),
      });
    }

    const match = await bcrypt.compare(password || '', user.password_hash);
    if (!match) {
      const lock = await registerFailedLogin(user);
      await logAudit(user.id, lock.locked ? 'LOGIN_LOCKED' : 'LOGIN_FAILED', req);
      if (lock.locked) {
        return res.status(423).json({
          message: `Too many failed sign-in attempts. This account is locked for ${lock.minutes} ${lock.minutes === 1 ? 'minute' : 'minutes'}.`,
          retryAfter: lock.minutes * 60,
          lockedUntil: lock.lockedUntil,
        });
      }
      return res.status(401).json({
        message: 'Invalid email or password.',
        attemptsLeft: lock.attemptsLeft,
      });
    }

    if (!user.is_active) {
      return res.status(403).json({ message: 'This account has been disabled.' });
    }

    // Correct password, but the email address has not been verified yet:
    // refuse the sign-in, make sure a verification link is on its way, and
    // hand the page a ticket so it can wait for the link to be clicked.
    if (requiresEmailVerification(user)) {
      await pool.query(
        'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1',
        [user.id]
      );
      const mail = await ensureVerificationEmail(user);
      await logAudit(user.id, 'LOGIN_BLOCKED_UNVERIFIED', req);
      return res.status(403).json({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email address before signing in.',
        emailSent: mail.ok,
        retryAfter: mail.retryAfter,
        ticket: signVerificationTicket(user.id),
      });
    }

    await pool.query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL,
       lockout_count = 0, last_failed_login_at = NULL, last_login_at = NOW()
       WHERE id = $1`,
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
    res.status(500).json({ message: 'We could not sign you in. Please try again.' });
  }
}

async function getMe(req, res) {
  try {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Account not found.' });
    res.json(publicUser(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'We could not load your account. Please try again.' });
  }
}

async function updateProfile(req, res) {
  try {
    const { firstName, middleName, lastName } = req.body || {};

    const problems = [];
    if (!isValidName(firstName)) problems.push('First name is required and should contain letters only.');
    if (!isValidName(lastName)) problems.push('Last name is required and should contain letters only.');
    // An initial is one letter, so the 2-character minimum for names is wrong here.
    if (!isValidName(middleName, { required: false, min: 1, max: INITIAL_MAX })) problems.push(`M.I. should contain letters only (up to ${INITIAL_MAX} characters).`);
    if (problems.length) return res.status(400).json({ message: problems[0], errors: problems });

    const names = {
      firstName: firstName.trim(),
      middleName: middleName ? middleName.trim() : null,
      lastName: lastName.trim(),
    };
    let updated = await updateGuardianProfile(pool, req.user.id, names);
    if (updated) {
      // The account name (greeting) is kept on users as well.
      await pool.query(
        'UPDATE users SET first_name = $2, middle_initial = $3, last_name = $4, updated_at = NOW() WHERE id = $1',
        [req.user.id, names.firstName, names.middleName, names.lastName]
      );
    } else {
      // Staff accounts (admin, registrar) have no guardian row; their name
      // lives on the users table.
      const { rows: [u] } = await pool.query(
        `UPDATE users SET first_name = $2, middle_initial = $3, last_name = $4,
                full_name = $5, updated_at = NOW()
         WHERE id = $1
         RETURNING first_name, middle_initial AS middle_name, last_name`,
        [req.user.id, names.firstName, names.middleName, names.lastName, `${names.firstName} ${names.lastName}`]
      );
      updated = u;
    }
    if (!updated) return res.status(404).json({ message: 'Profile not found.' });

    await logAudit(req.user.id, 'PROFILE_UPDATED', req);
    res.json({
      firstName: updated.first_name, middleName: updated.middle_name, lastName: updated.last_name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'We could not update your profile. Please try again.' });
  }
}

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!isText(currentPassword) || !isText(newPassword) || !currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Your current password and a new password are required.' });
    }
    if (Buffer.byteLength(currentPassword) > PASSWORD_MAX_BYTES) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
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
    // Choosing a password of their own clears the "temporary password" flag.
    await pool.query('UPDATE users SET must_change_password = FALSE WHERE id = $1', [req.user.id]);

    await logAudit(req.user.id, 'PASSWORD_CHANGED', req);
    res.json({ message: 'Password updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'We could not update your password. Please try again.' });
  }
}

async function checkEmail(req, res) {
  try {
    const email = (req.query.email || '').toString();

    // Public sign-up makes a parent account, and a parent signs in with their
    // own Gmail — so this answers for a Gmail, not for any address.
    if (!isValidGmail(email)) {
      return res.json({ valid: false, reason: GMAIL_MESSAGE });
    }

    const gate = await checkEmailAcceptable(email, { requireGmail: true });
    if (!gate.ok) {
      return res.json({ valid: false, reason: gate.reason });
    }

    const existing = await findUserByEmail(normalizeGmail(email));
    if (existing) {
      return res.json({ valid: false, reason: 'An account with that email address already exists.' });
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

/**
 * What is behind a verification link, without using it up.
 *
 * The page needs to know before it shows anything whether this account still
 * has to choose a password — an account made for a parent at the front desk
 * has no password they know. Verifying consumes the token, so that question
 * has to be answerable first.
 */
async function inspectVerificationToken(req, res) {
  try {
    const token = (req.query.token || '').toString();
    if (!token || token.length > 200) {
      return res.status(400).json({ message: 'This link is invalid or has expired.' });
    }
    const row = await findValidToken(token, 'email_verify');
    if (!row) {
      const record = await findTokenRecord(token, 'email_verify');
      if (record) {
        const { rows: [u] } = await pool.query('SELECT email_verified_at FROM users WHERE id = $1', [record.user_id]);
        if (u?.email_verified_at) {
          return res.json({ valid: false, alreadyVerified: true, message: 'Your email address is already verified. You can sign in.' });
        }
      }
      return res.status(400).json({ message: 'This link is invalid or has expired.' });
    }
    const { rows: [user] } = await pool.query(
      'SELECT email, must_change_password FROM users WHERE id = $1', [row.user_id]
    );
    res.json({
      valid: true,
      email: user?.email || '',
      mustSetPassword: Boolean(user?.must_change_password),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'We could not check that link. Please try again.' });
  }
}

async function verifyEmail(req, res) {
  try {
    // The token arrives in the query on a plain click, or in the body when the
    // parent is also choosing their password on the same screen.
    const token = (req.query.token || req.body?.token || '').toString();
    const newPassword = typeof req.body?.password === 'string' ? req.body.password : null;
    if (!token || token.length > 200) {
      return res.status(400).json({ message: 'This verification link is invalid or has expired.' });
    }
    const row = await findValidToken(token, 'email_verify');

    if (row) {
      const { rows: [account] } = await pool.query(
        'SELECT must_change_password FROM users WHERE id = $1', [row.user_id]
      );
      const mustSetPassword = Boolean(account?.must_change_password);

      // An account created at the front desk has no password its owner knows.
      // It is set here, from the link only they received, so no temporary
      // password ever has to be read out or written on a slip of paper.
      if (mustSetPassword) {
        if (!newPassword) {
          return res.status(400).json({
            message: 'Choose a password to finish setting up your account.',
            reason: 'password_required',
          });
        }
        const issues = passwordIssues(newPassword);
        if (issues.length) {
          return res.status(400).json({ message: `Password needs ${issues.join(', ')}.` });
        }
        const passwordHash = await bcrypt.hash(newPassword, 12);
        await pool.query(
          `UPDATE users
              SET password_hash = $2, must_change_password = FALSE,
                  failed_login_attempts = 0, locked_until = NULL,
                  email_verified_at = COALESCE(email_verified_at, NOW())
            WHERE id = $1`,
          [row.user_id, passwordHash]
        );
        await consumeToken(row.id);
        await logAudit(row.user_id, 'EMAIL_VERIFIED', req);
        await logAudit(row.user_id, 'PASSWORD_SET_FROM_LINK', req);
        return res.json({
          message: 'Your email address is verified and your password is set. You can now sign in.',
          passwordSet: true,
        });
      }

      await pool.query(
        `UPDATE users SET email_verified_at = NOW() WHERE id = $1 AND email_verified_at IS NULL`,
        [row.user_id]
      );
      await consumeToken(row.id);
      await logAudit(row.user_id, 'EMAIL_VERIFIED', req);
      return res.json({ message: 'Your email address has been verified. You can now sign in.' });
    }

    // Not currently valid -- but before calling it dead, check whether
    // THIS exact link's account is already verified. This is the common
    // case of clicking an older email after a newer "resend" already
    // succeeded: the old link is correctly invalidated, but "invalid or
    // expired" is a confusing thing to tell someone who actually already
    // finished verifying.
    const record = await findTokenRecord(token, 'email_verify');
    if (record) {
      const userResult = await pool.query('SELECT email_verified_at FROM users WHERE id = $1', [record.user_id]);
      if (userResult.rows[0]?.email_verified_at) {
        return res.json({ message: 'Your email address is already verified. You can sign in.' });
      }
    }

    res.status(400).json({ message: 'This verification link is invalid or has expired.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'We could not verify your email address. Please try again.' });
  }
}

// For a signed-in user (the banner shown to a parent who is already in).
async function resendVerification(req, res) {
  try {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Account not found.' });
    return await resendFor(user, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'We could not resend the verification email. Please try again.' });
  }
}

// For someone who could not sign in yet: authorised by the ticket from
// register() or from the refused sign-in, not by a login token.
async function resendVerificationByTicket(req, res) {
  try {
    const userId = readVerificationTicket(req.body?.ticket);
    if (!userId) {
      return res.status(401).json({ message: 'This verification session has expired. Please sign in again.' });
    }
    const user = await findUserById(userId);
    if (!user) return res.status(404).json({ message: 'Account not found.' });
    return await resendFor(user, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'We could not resend the verification email. Please try again.' });
  }
}

// Polled by the "Verifying email" screen until the link has been clicked.
async function verificationStatus(req, res) {
  try {
    const userId = readVerificationTicket(req.body?.ticket);
    if (!userId) {
      return res.status(401).json({ message: 'This verification session has expired. Please sign in again.' });
    }
    const result = await pool.query('SELECT email_verified_at FROM users WHERE id = $1', [userId]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Account not found.' });
    res.json({ verified: Boolean(result.rows[0].email_verified_at) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'We could not check your verification status.' });
  }
}

async function forgotPassword(req, res) {
  // Always the same response, whether or not the account exists -- this
  // endpoint must never become a way to check which emails are registered.
  const generic = () => res.json({ message: 'If an account exists for that email address, we have sent a reset link.' });

  try {
    const { email } = req.body || {};
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
    const { token, newPassword } = req.body || {};
    if (!isText(token) || !token || token.length > 200) {
      return res.status(400).json({ message: 'This reset link is invalid or has expired.' });
    }
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
    res.json({ message: 'Your password has been updated. You can now sign in.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'We could not reset your password. Please try again.' });
  }
}

module.exports = {
  // Shared with walk-in enrollment, which makes a parent account at the desk
  // and needs the same verification link to go out.
  sendVerificationEmail,
  register, login, getMe, updateProfile, changePassword, checkEmail,
  inspectVerificationToken, verifyEmail, resendVerification, resendVerificationByTicket, verificationStatus,
  forgotPassword, resetPassword,
};