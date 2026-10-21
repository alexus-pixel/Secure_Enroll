const nodemailer = require('nodemailer');
const { renderEmail, SCHOOL } = require('./emailTemplate');

// The public address of the website (the FIRST one if several are listed, no
// trailing slash). Deployed, this must be the real https address: it is what a
// parent's phone opens when they tap the link in their email.
const CLIENT_URL = () => (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')[0].trim().replace(/\/+$/, '');

// How email leaves the server:
//   * Brevo's web API (BREVO_API_KEY + BREVO_SENDER_EMAIL) is used for EVERY
//     email when it is set up. Hosts such as Render block SMTP ports, so on a
//     deployed server Brevo is the only route that works.
//   * If Brevo refuses and SMTP_* is filled in, the same email goes through
//     SMTP instead, so a Brevo problem does not stop an email.
//   * With only SMTP_* set, SMTP is used (fine on your own computer).
//   * With neither, the email is printed in the server console, so local
//     development works without any mail account.
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const host = (process.env.SMTP_HOST || '').trim();
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = (process.env.SMTP_USER || '').trim();
  // Gmail shows App Passwords as four groups with spaces ("abcd efgh ijkl mnop").
  // Pasted into .env with the spaces, they are rejected, so remove all whitespace.
  const pass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
    // Fail fast with a clear error instead of hanging when the port is blocked.
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
  return transporter;
}

// Turns a mail error into a plain sentence that says what to fix. Used in the
// server console and by scripts/testEmail.js; parents never see these details.
function describeMailError(err) {
  const msg = String((err && err.message) || err || 'unknown error');
  if (/^Brevo 401/.test(msg) && /IP address|unrecogni[sz]ed/i.test(msg)) {
    return 'Brevo refused the IP address of this server. In Brevo go to Security > Authorised IPs and deactivate IP blocking (or add the server IP), then try again.';
  }
  if (/^Brevo 401/.test(msg)) return 'Brevo rejected the API key. Check BREVO_API_KEY (use a v3 API key, not an SMTP key).';
  if (/^Brevo 400/.test(msg) && /sender/i.test(msg)) {
    return 'Brevo does not accept the sender. BREVO_SENDER_EMAIL must be a sender you verified in Brevo (Senders, Domains & Dedicated IPs).';
  }
  if (/^Brevo 4\d\d/.test(msg)) return 'Brevo refused the request. See the message above.';
  if (/BREVO_SENDER_EMAIL is not set/.test(msg)) return msg;
  if (err && (err.code === 'EAUTH' || /535|Invalid login|Username and Password not accepted/i.test(msg))) {
    return 'The SMTP server rejected the login. For Gmail, turn on 2-Step Verification and use a 16-letter App Password as SMTP_PASS (not your normal password), with SMTP_USER set to the same Gmail address.';
  }
  if (err && ['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNREFUSED', 'ENOTFOUND', 'EDNS'].includes(err.code)) {
    return 'Could not reach the SMTP server. Check SMTP_HOST and SMTP_PORT (Gmail: smtp.gmail.com with 587, or 465), and that your network or firewall allows outgoing mail.';
  }
  if (/fetch failed|aborted|timeout/i.test(msg)) return 'Could not reach Brevo. Check the internet connection of the server.';
  return msg;
}

// True when Brevo can be used: it needs the API key AND a verified sender.
function brevoReady() {
  return Boolean((process.env.BREVO_API_KEY || '').trim() && (process.env.BREVO_SENDER_EMAIL || '').trim());
}

// Brevo transactional email API. attachments: [{ filename, content: Buffer }]
async function sendViaBrevo({ to, subject, text, html, attachments, replyTo }) {
  const res = await fetch(process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: {
      'api-key': (process.env.BREVO_API_KEY || '').trim(),
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: {
        name: process.env.BREVO_SENDER_NAME || SCHOOL,
        email: (process.env.BREVO_SENDER_EMAIL || '').trim(),
      },
      to: [{ email: to }],
      // A reply goes to the staff member who enrolled the child, not to the
      // system's no-reply sender.
      ...(replyTo && replyTo.email ? { replyTo: { email: replyTo.email, ...(replyTo.name ? { name: replyTo.name } : {}) } } : {}),
      subject,
      htmlContent: html,
      textContent: text,
      ...(attachments && attachments.length ? {
        attachment: attachments.map((a) => ({
          name: a.filename,
          content: Buffer.from(a.content).toString('base64'),
        })),
      } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
}

function printDevEmail({ to, subject, text }, why) {
  console.log(`\n----- DEV EMAIL (${why}, printing instead of sending) -----`);
  console.log('To:', to);
  console.log('Subject:', subject);
  console.log(text);
  console.log('---------------------------------------------------------------------\n');
}

// SMTP only (or the console when SMTP is not configured). Never uses Brevo.
async function sendSmtp({ to, subject, text, html, attachments, replyTo }) {
  const t = getTransporter();
  if (!t) return printDevEmail({ to, subject, text }, 'SMTP not configured');
  const smtpUser = (process.env.SMTP_USER || '').trim();
  const from = process.env.SMTP_FROM || `${SCHOOL} <${smtpUser || 'no-reply@secureenroll.local'}>`;
  await t.sendMail({
    from, to, subject, text, html, attachments,
    ...(replyTo && replyTo.email ? { replyTo: replyTo.name ? `${replyTo.name} <${replyTo.email}>` : replyTo.email } : {}),
  });
}

// Sends any email: Brevo first when it is set up, then SMTP, then the console.
async function sendMail(message) {
  if (!brevoReady()) return sendSmtp(message);
  try {
    return await sendViaBrevo(message);
  } catch (brevoErr) {
    if (!(process.env.SMTP_HOST || '').trim()) throw brevoErr;
    console.error('Brevo could not send an email, trying SMTP instead.');
    console.error('  Reason:', brevoErr.message);
    console.error('  Fix:   ', describeMailError(brevoErr));
    return sendSmtp(message);
  }
}

// The account verification link: Brevo when it is set up, otherwise SMTP.
// If Brevo is set up but refuses (bad key, unverified sender, blocked IP, outage)
// and SMTP is configured, the same email is sent through SMTP instead, so a
// Brevo problem does not stop parents from verifying their account.
async function sendVerificationMail({ to, subject, text, html, replyTo }) {
  const brevoKey = (process.env.BREVO_API_KEY || '').trim();
  if (!brevoKey) return sendSmtp({ to, subject, text, html, replyTo });
  try {
    if (!(process.env.BREVO_SENDER_EMAIL || '').trim()) {
      throw new Error('BREVO_SENDER_EMAIL is not set. Use a sender that is verified in Brevo.');
    }
    return await sendViaBrevo({ to, subject, text, html, replyTo });
  } catch (brevoErr) {
    if (!(process.env.SMTP_HOST || '').trim()) throw brevoErr;
    console.error('Brevo could not send the verification email, trying SMTP instead.');
    console.error('  Reason:', brevoErr.message);
    console.error('  Fix:   ', describeMailError(brevoErr));
    return sendSmtp({ to, subject, text, html, replyTo });
  }
}

/**
 * The link that finishes an account.
 *
 * `setPassword` is true for a parent whose child was enrolled at the school
 * office: they never chose a password, so the same link is where they set one.
 * Nothing temporary is ever handed over at the counter.
 */
function verificationEmail(token, firstName, { setPassword = false, enrolledBy = null } = {}) {
  const link = `${CLIENT_URL()}/verify-email?token=${encodeURIComponent(token)}`;
  if (setPassword) {
    const { html: h, text: t } = renderEmail({
      preheader: 'Choose a password to finish setting up your parent account.',
      heading: 'Set your password',
      greeting: firstName ? `Hello ${firstName},` : 'Hello,',
      paragraphs: [
        enrolledBy
          ? `${enrolledBy} from the registrar's office enrolled your child at ${SCHOOL}, and a parent account has been created for you with this email address.`
          : `Your child has been enrolled at ${SCHOOL}, and a parent account has been created for you with this email address.`,
        'Open the link below to choose your own password. That also confirms this address is yours, so there is nothing else to do afterwards.',
      ],
      button: { label: 'Set my password', url: link },
      steps: [
        'Open the link above and choose a password.',
        'Sign in with this email address and the password you chose.',
        "Follow your child's enrollment and requirements from your dashboard.",
      ],
      notice: 'This link expires in 24 hours. If it does, use "Forgot password" on the sign-in page to get a new one. If you were not expecting this email, please contact the school office.',
    });
    return { subject: `Set your password - ${SCHOOL} parent account`, text: t, html: h };
  }
  const { html, text } = renderEmail({
    preheader: 'Confirm your email address to finish creating your parent account.',
    heading: 'Confirm your email address',
    greeting: firstName ? `Hello ${firstName},` : 'Hello,',
    paragraphs: [
      `Thank you for creating a parent account on the online enrollment system of ${SCHOOL}.`,
      'Please confirm that this email address is yours so we can finish setting up your account.',
    ],
    button: { label: 'Verify my email address', url: link },
    steps: [
      'Open the link above to confirm your email address.',
      'Sign in with your email address and the password you chose.',
      "Submit your child's enrollment application and upload the required documents.",
    ],
    notice: 'This link expires in 24 hours. If you did not create an account, you can ignore this email and no further action is needed.',
  });
  return { subject: `Confirm your email - ${SCHOOL} enrollment account`, text, html };
}

function passwordResetEmail(token) {
  const link = `${CLIENT_URL()}/reset-password?token=${encodeURIComponent(token)}`;
  const { html, text } = renderEmail({
    preheader: 'Choose a new password for your enrollment account.',
    heading: 'Reset your password',
    greeting: 'Hello,',
    paragraphs: [
      `We received a request to reset the password of your ${SCHOOL} enrollment account.`,
      'Use the button below to choose a new password.',
    ],
    button: { label: 'Choose a new password', url: link },
    notice: 'This link expires in 1 hour. If you did not ask for this, ignore this email and your password will stay the same.',
  });
  return { subject: `Reset your password - ${SCHOOL} enrollment account`, text, html };
}

module.exports = { sendMail, brevoReady, sendVerificationMail, verificationEmail, passwordResetEmail, describeMailError };
