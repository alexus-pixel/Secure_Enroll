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

async function sendMail({ to, subject, text, html }) {
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
    text: `Welcome to SecureEnroll! Confirm your email address:\n\n${link}\n\n`
      + `This link expires in 24 hours. If you didn't create this account, you can ignore this email.`,
    html: `<p>Welcome to SecureEnroll! Confirm your email address:</p>`
      + `<p><a href="${link}">${link}</a></p>`
      + `<p>This link expires in 24 hours. If you didn't create this account, you can ignore this email.</p>`,
  };
}

function passwordResetEmail(token) {
  const link = `${CLIENT_URL}/reset-password?token=${token}`;
  return {
    subject: 'Reset your SecureEnroll password',
    text: `We received a request to reset your SecureEnroll password:\n\n${link}\n\n`
      + `This link expires in 1 hour. If you didn't request this, your password won't change -- you can ignore this email.`,
    html: `<p>We received a request to reset your SecureEnroll password:</p>`
      + `<p><a href="${link}">${link}</a></p>`
      + `<p>This link expires in 1 hour. If you didn't request this, your password won't change -- you can ignore this email.</p>`,
  };
}

module.exports = { sendMail, verificationEmail, passwordResetEmail };
