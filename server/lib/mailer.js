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

async function sendPdfsEmail({ to, subject, text, attachments }) {
  const transport = getTransport();
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    attachments, // [{ filename, content: Buffer }]
  });
}

module.exports = { sendPdfsEmail };
