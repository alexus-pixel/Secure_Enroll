const pool = require('./db/pool');
// One shared sender: uses Brevo when BREVO_API_KEY is set, otherwise SMTP, otherwise
// prints the email in the server console (development).
const { sendMail: send } = require('./utils/mailer');

function sendMail(to, subject, text) {
  return send({ to, subject, text });
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

/**
 * Tells every guardian of a learner that the LRN on file could not be found
 * in the DepEd LIS and has to be corrected. Never throws: the flag itself is
 * already saved, and an email problem must not undo it.
 */
async function notifyLrnFlagged(studentId, note) {
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
        `Please check the LRN for ${r.child}`,
        `Hello,\n\n` +
        `The school registrar could not find the Learner Reference Number (LRN) on file for ${r.child} ` +
        `in the DepEd Learner Information System.\n\n` +
        (note ? `Note from the registrar: ${note}\n\n` : '') +
        `Please sign in and enter the correct 12-digit LRN from the learner's Form 137 or report card` +
        (process.env.CLIENT_URL ? `: ${process.env.CLIENT_URL}` : '.') +
        `\n\nThe LRN itself is never included in this email.\n\nCaloocan City Elementary School`
      );
    }
    return rows.length;
  } catch (err) {
    console.error('LRN flag notification failed:', err.message);
    return 0;
  }
}

const SCHOOL = 'Caloocan City Elementary School';
const signIn = () => (process.env.CLIENT_URL ? `: ${process.env.CLIENT_URL}` : '.');

// Active guardians of a learner who can actually receive mail. Walk-in
// placeholder addresses (@walkin.invalid) are not real mailboxes.
async function guardianEmails(db, studentId) {
  const { rows } = await db.query(
    `SELECT DISTINCT u.email
     FROM student_guardians sg JOIN users u ON u.id = sg.guardian_id
     WHERE sg.student_id = $1 AND u.is_active AND u.email NOT LIKE '%@walkin.invalid'`,
    [studentId]
  );
  return rows.map((r) => r.email);
}

/**
 * Emails the parent(s) the result of the registrar's review (FR-REV-02):
 *   approved        -> enrolled, with the section when there is one
 *   needs_revision  -> what to fix (the registrar's reason) and to resubmit
 *   rejected        -> the reason
 *   placed          -> approved earlier, now placed in a section
 * No LRN, birth date or document contents are put in the email, only the
 * learner's first name, grade, section and the registrar's own remark.
 * Never throws: an email problem must not undo the decision.
 */
async function notifyApplicationDecision(applicationId, kind) {
  try {
    const { rows: [a] } = await pool.query(
      `SELECT ea.student_id, ea.remarks, s.first_name AS child, gl.name AS grade,
              sy.label AS school_year, sec.name AS section
       FROM enrollment_applications ea
       JOIN students s ON s.id = ea.student_id
       JOIN grade_levels gl ON gl.id = ea.grade_level_id
       JOIN school_years sy ON sy.id = ea.school_year_id
       LEFT JOIN sections sec ON sec.id = ea.section_id
       WHERE ea.id = $1`,
      [applicationId]
    );
    if (!a) return 0;
    const to = await guardianEmails(pool, a.student_id);
    if (!to.length) return 0;

    const where = `${a.grade}${a.section ? ` \u00b7 ${a.section}` : ''}, School Year ${a.school_year}`;
    let subject; let body;
    if (kind === 'approved') {
      subject = `Enrollment approved for ${a.child}`;
      body = `Good news: ${a.child}'s enrollment has been approved.\n\n` +
        `Grade and section: ${where}.\n` +
        (a.section ? '' : 'The school will place your child in a section and let you know.\n') +
        `\nWhen the class schedule is published you will get another email, and you can view it by signing in${signIn()}`;
    } else if (kind === 'placed') {
      subject = `${a.child} has been placed in a section`;
      body = `${a.child} has been placed in ${where}.\n\nYou can check the status by signing in${signIn()}`;
    } else if (kind === 'needs_revision') {
      subject = `Action needed for ${a.child}'s enrollment`;
      body = `The registrar reviewed ${a.child}'s enrollment application and needs a correction before it can be approved.\n\n` +
        `Registrar's note: ${a.remarks || '(see your dashboard)'}\n\n` +
        `Please sign in, replace the document(s) that were returned and submit again${signIn()}`;
    } else if (kind === 'rejected') {
      subject = `Update on ${a.child}'s enrollment application`;
      body = `The registrar was not able to approve ${a.child}'s enrollment application for ${where}.\n\n` +
        `Registrar's note: ${a.remarks || '(see your dashboard)'}\n\n` +
        `If you have questions, please visit the school office. You can also sign in to see the details${signIn()}`;
    } else {
      return 0;
    }
    for (const email of to) {
      await sendMail(email, subject, `Hello,\n\n${body}\n\n${SCHOOL}`);
    }
    return to.length;
  } catch (err) {
    console.error('Application notification failed:', err.message);
    return 0;
  }
}

/**
 * Emails the parents of every approved learner in a section that the class
 * schedule is now published. One email per parent, naming each of their
 * children in that section. Never throws.
 */
async function notifySchedulePublished(sectionId) {
  try {
    const { rows } = await pool.query(
      `SELECT u.email, s.first_name AS child, gl.name AS grade, sec.name AS section, sy.label AS school_year
       FROM enrollment_applications ea
       JOIN sections sec ON sec.id = ea.section_id
       JOIN grade_levels gl ON gl.id = sec.grade_level_id
       JOIN school_years sy ON sy.id = ea.school_year_id
       JOIN students s ON s.id = ea.student_id
       JOIN student_guardians sg ON sg.student_id = s.id
       JOIN users u ON u.id = sg.guardian_id
       WHERE ea.section_id = $1 AND ea.status = 'approved'
         AND u.is_active AND u.email NOT LIKE '%@walkin.invalid'
       ORDER BY u.email, s.first_name`,
      [sectionId]
    );
    const byParent = new Map();
    for (const r of rows) {
      if (!byParent.has(r.email)) byParent.set(r.email, { kids: [], where: `${r.grade} \u00b7 ${r.section}`, year: r.school_year });
      const entry = byParent.get(r.email);
      if (!entry.kids.includes(r.child)) entry.kids.push(r.child);
    }
    for (const [email, { kids, where, year }] of byParent) {
      const names = kids.length > 1 ? `${kids.slice(0, -1).join(', ')} and ${kids[kids.length - 1]}` : kids[0];
      await sendMail(
        email,
        `Class schedule published for ${names}`,
        `Hello,\n\nThe class schedule for ${where} (School Year ${year}) has been published, ` +
        `so you can now see ${names}'s weekly timetable.\n\n` +
        `Sign in and open "Schedule"${signIn()}\n\n${SCHOOL}`
      );
    }
    return byParent.size;
  } catch (err) {
    console.error('Schedule notification failed:', err.message);
    return 0;
  }
}

module.exports = { sendMail, notifyLrnRecorded, notifyLrnFlagged, notifyApplicationDecision, notifySchedulePublished };