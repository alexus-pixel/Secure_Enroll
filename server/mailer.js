const nodemailer = require('nodemailer');
const pool = require('./db/pool');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false, // port 587 upgrades with STARTTLS
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

function sendMail(to, subject, text) {
  return transporter.sendMail({ from: process.env.SMTP_FROM, to, subject, text });
}

// Emails every guardian of the student that an LRN is now on file.
// Never throws: an email problem must not undo a saved LRN.
// The LRN itself is deliberately NOT included in the email.
async function notifyLrnRecorded(studentId) {
  try {
    const { rows } = await pool.query(
      `SELECT u.email, s.first_name AS child
       FROM student_guardians sg
       JOIN users u ON u.id = sg.guardian_id
       JOIN students s ON s.id = sg.student_id
       WHERE sg.student_id = $1
         AND u.is_active
         AND u.email NOT LIKE '%@walkin.invalid'`,
      [studentId]
    );
    for (const r of rows) {
      await sendMail(
        r.email,
        `LRN recorded for ${r.child}`,
        `Hello,\n\n` +
        `The school registrar has recorded the Learner Reference Number (LRN) for ${r.child}.\n` +
        `You can check your enrollment status by logging in to SecureEnroll` +
        (process.env.CLIENT_URL ? `: ${process.env.CLIENT_URL}` : '.') +
        `\n\nCaloocan City Elementary School`
      );
    }
    return rows.length;
  } catch (err) {
    console.error('LRN notification failed:', err.message);
    return 0;
  }
}

module.exports = { sendMail, notifyLrnRecorded };