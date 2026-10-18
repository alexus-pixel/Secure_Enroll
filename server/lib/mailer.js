const nodemailer = require('nodemailer');

/**
 * Reads SMTP settings from env at call time rather than at module
 * load, so a missing config fails with a clear error exactly when
 * someone tries to use it, not silently at server startup.
 *
 * This intentionally does not hardcode any provider. Fill in
 * SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS in your .env — for
 * a school project, a free tier from your existing email provider
 * or a service like Mailtrap (for testing) both work fine here.
 */
function getTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    const err = new Error('Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS.');
    err.status = 503;
    throw err;
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

/**
 * MAIL_CAPTURE_DIR is for development and automated tests only: when set, the
 * message and its attachments are written to that folder instead of being
 * sent, so the whole flow can be exercised without a mail account.
 */
async function captureEmail(dir, message) {
  const fs = require('fs');
  const path = require('path');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const files = [];
  for (const a of message.attachments || []) {
    const name = `${stamp}-${a.filename}`;
    fs.writeFileSync(path.join(dir, name), a.content);
    files.push(name);
  }
  fs.writeFileSync(path.join(dir, `${stamp}.json`), JSON.stringify({
    to: message.to, subject: message.subject, text: message.text, hasHtml: Boolean(message.html), attachments: files,
  }, null, 2));
}

async function sendPdfsEmail({ to, subject, text, html, attachments }) {
  const message = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to, subject, text, html,
    attachments, // [{ filename, content: Buffer }]
  };
  if (process.env.MAIL_CAPTURE_DIR) return captureEmail(process.env.MAIL_CAPTURE_DIR, message);
  const transport = getTransport();
  await transport.sendMail(message);
}

module.exports = { sendPdfsEmail };
