const nodemailer = require('nodemailer');
const { renderEmail, SCHOOL } = require('./emailTemplate');

const CLIENT_URL = () => process.env.CLIENT_URL || 'http://localhost:5173';

// Which service sends what:
//   * Brevo (BREVO_API_KEY)  -> ONLY the account verification link.
//   * SMTP  (SMTP_* values)  -> everything else: password reset, LRN notices
//                               and the teacher PDFs (see lib/mailer.js).
// If a service is not configured, the email is printed in the server console
// instead, so local development works without any mail account.
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

// Brevo transactional email API. Used ONLY by sendVerificationMail below.
async function sendViaBrevo({ to, subject, text, html }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: {
        name: process.env.BREVO_SENDER_NAME || SCHOOL,
        email: process.env.BREVO_SENDER_EMAIL,
      },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
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

// SMTP only. Never uses Brevo.
async function sendMail({ to, subject, text, html, attachments }) {
  const t = getTransporter();
  if (!t) return printDevEmail({ to, subject, text }, 'SMTP not configured');
  const from = process.env.SMTP_FROM || `${SCHOOL} <${process.env.SMTP_USER || 'no-reply@secureenroll.local'}>`;
  await t.sendMail({ from, to, subject, text, html, attachments });
}

// The account verification link: Brevo when it is set up, otherwise SMTP.
async function sendVerificationMail({ to, subject, text, html }) {
  if (!process.env.BREVO_API_KEY) return sendMail({ to, subject, text, html });
  if (!process.env.BREVO_SENDER_EMAIL) {
    throw new Error('BREVO_SENDER_EMAIL is not set. Use a sender that is verified in Brevo.');
  }
  return sendViaBrevo({ to, subject, text, html });
}

function verificationEmail(token, firstName) {
  const link = `${CLIENT_URL()}/verify-email?token=${encodeURIComponent(token)}`;
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

module.exports = { sendMail, sendVerificationMail, verificationEmail, passwordResetEmail };
