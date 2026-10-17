const { sendMail, isMailConfigured } = require('../utils/mailer');

/**
 * Sends the teachers' PDFs. Unlike registration emails (which fall back to
 * printing in the console for local development), this feature is pointless
 * without real delivery, so it reports "not configured" instead of pretending
 * to succeed. Configure BREVO_API_KEY (recommended when deployed) or
 * SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS.
 */
async function sendPdfsEmail({ to, subject, text, attachments }) {
  if (!isMailConfigured()) {
    const err = new Error('Email is not configured. Set BREVO_API_KEY, or SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS.');
    err.status = 503;
    throw err;
  }
  await sendMail({ to, subject, text, attachments }); // [{ filename, content: Buffer }]
}

module.exports = { sendPdfsEmail };
