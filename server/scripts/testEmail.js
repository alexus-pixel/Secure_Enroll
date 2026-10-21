/**
 * Sends one real verification-style email and prints the exact reason when it
 * fails. Run it from the server folder, with the same .env the server uses:
 *
 *   node scripts/testEmail.js someone@gmail.com
 *
 * It goes through the same code as the sign-up verification email (Brevo first
 * when BREVO_API_KEY is set, then SMTP), so if this works, sign-up works.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sendVerificationMail, verificationEmail, describeMailError } = require('../utils/mailer');

const to = process.argv[2];
if (!to) {
  console.error('Usage: node scripts/testEmail.js someone@example.com');
  process.exit(1);
}

const has = (k) => (process.env[k] || '').trim() !== '';
console.log('Brevo key set:     ', has('BREVO_API_KEY') ? 'yes' : 'no');
console.log('Brevo sender set:  ', has('BREVO_SENDER_EMAIL') ? 'yes' : 'no');
console.log('SMTP host set:     ', has('SMTP_HOST') ? process.env.SMTP_HOST.trim() + ':' + (process.env.SMTP_PORT || 587) : 'no');
console.log('SMTP user/pass set:', has('SMTP_USER') && has('SMTP_PASS') ? 'yes' : 'no');
console.log('Client URL:        ', process.env.CLIENT_URL || '(not set, using http://localhost:5173)');
console.log('');

(async () => {
  const { subject, text, html } = verificationEmail('test-token-not-real', 'Tester');
  try {
    await sendVerificationMail({ to, subject, text, html });
    console.log(has('BREVO_API_KEY') || has('SMTP_HOST')
      ? `OK: the email was handed to the mail service for ${to}. Check the inbox and the spam folder.`
      : 'Nothing was sent: neither Brevo nor SMTP is configured, so the email was only printed above.');
  } catch (err) {
    console.error('FAILED:', err.message);
    console.error('What to do:', describeMailError(err));
    process.exitCode = 1;
  }
})();
