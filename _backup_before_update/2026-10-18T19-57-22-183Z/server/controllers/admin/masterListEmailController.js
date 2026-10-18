const pool = require('../../db/pool');
const settingsDb = require('../../db/admin/settings');
const { logAudit } = require('../../lib/audit');
const { computeEnrollment } = require('../../utils/enrollmentStatus');
const mail = require('../../lib/masterListMail');

const mailReady = () => Boolean(process.env.MAIL_CAPTURE_DIR || (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS));

async function activeYear(res) {
  const year = await pool.query(
    `SELECT id, label, opens_at, closes_at, is_active, enrollment_open, auto_email_lists
     FROM school_years WHERE is_active = TRUE LIMIT 1`
  ).then((r) => r.rows[0]);
  if (!year) res.status(404).json({ message: 'No active school year is set.' });
  return year;
}

async function overview(req, res) {
  try {
    const year = await activeYear(res);
    if (!year) return;
    const enrollment = computeEnrollment(year);
    res.json({
      schoolYear: year.label,
      auto: year.auto_email_lists,
      enrollmentState: enrollment.state,
      emailConfigured: mailReady(),
      sections: await mail.listSections(pool, year.id),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load the master list emails.' });
  }
}

async function send(req, res) {
  try {
    const year = await activeYear(res);
    if (!year) return;
    const sectionId = req.body?.sectionId ? Number(req.body.sectionId) : null;
    const results = await mail.sendNow({ year, sectionId });
    if (!results.length) return res.status(404).json({ message: 'Section not found.' });
    await logAudit(req.user.id, 'MASTER_LIST_EMAILED', 'section', sectionId, req, {
      sent: results.filter((r) => r.status === 'sent').length, total: results.length,
    });
    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not send the master lists.' });
  }
}

async function setAuto(req, res) {
  try {
    const year = await activeYear(res);
    if (!year) return;
    const auto = req.body?.auto === true;
    await pool.query('UPDATE school_years SET auto_email_lists = $1 WHERE id = $2', [auto, year.id]);
    await logAudit(req.user.id, 'MASTER_LIST_AUTO_EMAIL_CHANGED', 'school_year', year.id, req, { auto });
    res.json({ auto });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not save the setting.' });
  }
}

module.exports = { overview, send, setAuto };
