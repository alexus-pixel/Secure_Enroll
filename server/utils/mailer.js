const nodemailer = require('nodemailer');

const FROM = process.env.SMTP_FROM || 'SecureEnroll <no-reply@secureenroll.local>';
// No trailing slash, and only the first entry if several origins are listed.
// This MUST be the public address of the deployed frontend: it is what a
// parent's phone is told to open when they tap the link in their email.
const CLIENT_URL = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')[0].trim().replace(/\/+$/, '');

// Three ways to deliver, picked from the environment in this order:
//   1. BREVO_API_KEY -> Brevo's HTTP API (port 443). Use this on Render and
//                       most cloud hosts, which block outbound SMTP ports.
//   2. SMTP_HOST     -> any SMTP server through nodemailer.
//   3. neither       -> print the message to the server console, so
//                       registration and password reset still work locally.
// Every email in the app (verification, reset, LRN notice, teacher PDFs)
// goes through sendMail below, so this is the only place that needs to know.
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

// True when a real delivery route exists (as opposed to console printing).
function isMailConfigured() {
  return Boolean(process.env.BREVO_API_KEY || process.env.SMTP_HOST);
}

// "SecureEnroll <no-reply@school.edu>" -> { name, email }. Brevo wants the
// sender split apart. BREVO_SENDER_EMAIL / BREVO_SENDER_NAME win if set.
function brevoSender() {
  if (process.env.BREVO_SENDER_EMAIL) {
    return {
      name: process.env.BREVO_SENDER_NAME || 'SecureEnroll',
      email: process.env.BREVO_SENDER_EMAIL,
    };
  }
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(FROM);
  if (m) return { name: m[1].trim() || 'SecureEnroll', email: m[2].trim() };
  return { name: 'SecureEnroll', email: FROM.trim() };
}

// attachments: [{ filename, content: Buffer }]
async function sendViaBrevo({ to, subject, text, html, attachments }) {
  const body = {
    sender: brevoSender(),
    to: [{ email: to }],
    subject,
    htmlContent: html || `<p>${String(text).replace(/\n/g, '<br>')}</p>`,
    textContent: text,
  };
  if (attachments && attachments.length) {
    body.attachment = attachments.map((a) => ({
      name: a.filename,
      content: Buffer.from(a.content).toString('base64'),
    }));
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    // Don't let a slow mail API hang a request indefinitely.
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    // Brevo explains itself in the body (unverified sender, bad key, quota...).
    const detail = await res.text().catch(() => '');
    throw new Error(`Brevo API ${res.status}: ${detail.slice(0, 300)}`);
  }
}

async function sendMail({ to, subject, text, html, attachments }) {
  if (process.env.BREVO_API_KEY) {
    await sendViaBrevo({ to, subject, text, html, attachments });
    return;
  }
  const t = getTransporter();
  if (!t) {
    console.log('\n----- DEV EMAIL (mail not configured, printing instead of sending) -----');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log(text);
    if (attachments && attachments.length) {
      console.log('Attachments:', attachments.map((a) => a.filename).join(', '));
    }
    console.log('---------------------------------------------------------------------\n');
    return;
  }
  await t.sendMail({ from: FROM, to, subject, text, html, attachments });
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

module.exports = { sendMail, isMailConfigured, verificationEmail, passwordResetEmail };