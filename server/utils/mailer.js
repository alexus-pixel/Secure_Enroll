const nodemailer = require('nodemailer');

const FROM = process.env.SMTP_FROM || 'SecureEnroll <no-reply@secureenroll.local>';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// Built once, on first use. If SMTP_HOST isn't set, sendMail falls back to
// printing the message instead of sending it -- so registration and
// password reset work out of the box for local development and grading,
// without anyone first having to go set up a real mail account.
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

// Brevo transactional email API. Used when BREVO_API_KEY is set; otherwise
// sendMail falls back to SMTP, or to printing the email in dev.
async function sendViaBrevo({ to, subject, text, html }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: {
        name: process.env.BREVO_SENDER_NAME || 'SecureEnroll',
        email: process.env.BREVO_SENDER_EMAIL,
      },
      to: [{ email: to }],
      subject,
      htmlContent: html || `<p>${text}</p>`,
      textContent: text,
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
}

async function sendMail({ to, subject, text, html }) {
  if (process.env.BREVO_API_KEY) return sendViaBrevo({ to, subject, text, html });
  const t = getTransporter();
  if (!t) {
    console.log('\n----- DEV EMAIL (SMTP not configured, printing instead of sending) -----');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log(text);
    console.log('---------------------------------------------------------------------\n');
    return;
  }
  await t.sendMail({ from: FROM, to, subject, text, html });
}

function verificationEmail(token) {
  const link = `${CLIENT_URL}/verify-email?token=${token}`;
  return {
    subject: 'Verify your SecureEnroll account',
    text: `Welcome to SecureEnroll!\n\nPlease confirm your email address by opening the link below:\n\n${link}\n\n`
      + `This link expires in 24 hours. If you did not create this account, you can safely ignore this email.`,
    html: `<p>Welcome to SecureEnroll!</p>`
      + `<p>Please confirm your email address by clicking the link below:</p>`
      + `<p><a href="${link}">${link}</a></p>`
      + `<p>This link expires in 24 hours. If you did not create this account, you can safely ignore this email.</p>`,
  };
}

function passwordResetEmail(token) {
  const link = `${CLIENT_URL}/reset-password?token=${token}`;
  return {
    subject: 'Reset your SecureEnroll password',
    text: `We received a request to reset your SecureEnroll password. Open the link below to choose a new one:\n\n${link}\n\n`
      + `This link expires in 1 hour. If you did not request this, you can ignore this email and your password will stay the same.`,
    html: `<p>We received a request to reset your SecureEnroll password. Click the link below to choose a new one:</p>`
      + `<p><a href="${link}">${link}</a></p>`
      + `<p>This link expires in 1 hour. If you did not request this, you can ignore this email and your password will stay the same.</p>`,
  };
}

module.exports = { sendMail, verificationEmail, passwordResetEmail };