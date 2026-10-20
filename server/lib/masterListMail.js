const pool = require('../db/pool');
const { masterListPdf, teacherSchedulePdf, SCHOOL } = require('./pdf');
const { sendPdfsEmail } = require('./mailer');
const { renderEmail } = require('../utils/emailTemplate');
const { computeEnrollment } = require('../utils/enrollmentStatus');
const { enrollmentIsFull } = require('./seats');

/**
 * Emails each section's class master list, together with the recipient's
 * weekly teaching schedule, to the section's adviser (the teacher named as
 * adviser in School Settings; failing that, the teacher whose
 * schedule has an "Adviser" row for that section). When a section has no
 * adviser yet, the teacher who has the most periods in that section is used
 * instead, so a list is never held back only because the adviser row is
 * missing. Every attempt is written to masterlist_emails, which is what the
 * Reports page shows and what stops the same list being sent twice.
 */

const RETRY_AFTER_HOURS = 6;
const SCHEDULER_INTERVAL_MS = 60 * 60 * 1000;

const slug = (v) => String(v || '').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

async function sectionRoster(db, sectionId) {
  const result = await db.query(
    `SELECT s.first_name, s.middle_name, s.last_name, s.sex,
            pgp_sym_decrypt(s.lrn_encrypted, $2)::text AS lrn,
            g.first_name || ' ' || g.last_name AS guardian_name,
            pgp_sym_decrypt(g.contact_number, $2)::text AS guardian_contact
     FROM enrollment_applications ea
     JOIN students s ON s.id = ea.student_id
     LEFT JOIN student_guardians sg ON sg.student_id = s.id AND sg.is_primary = TRUE
     LEFT JOIN guardians g ON g.user_id = sg.guardian_id
     WHERE ea.section_id = $1 AND ea.status = 'approved'
     ORDER BY s.last_name, s.first_name`,
    [sectionId, process.env.ENCRYPTION_KEY]
  );
  return result.rows;
}

async function teacherEntries(db, teacherId, yearId) {
  const result = await db.query(
    `SELECT se.id, se.section_id, se.session, se.days, se.start_time, se.end_time, se.room, se.role_type,
            sub.name AS subject_name, sec.name AS section_name, gl.name AS grade_level_name
     FROM schedule_entries se
     JOIN sections sec ON sec.id = se.section_id
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     LEFT JOIN subjects sub ON sub.id = se.subject_id
     WHERE se.teacher_id = $1 AND se.school_year_id = $2
     ORDER BY se.start_time NULLS LAST`,
    [teacherId, yearId]
  );
  return result.rows;
}

// One row per section of the school year, with its recipient and last result.
async function listSections(db, yearId) {
  const result = await db.query(
    `SELECT sec.id, sec.name AS section_name, gl.name AS grade_level_name, gl.sort_order,
            (SELECT COUNT(*)::int FROM enrollment_applications ea
              WHERE ea.section_id = sec.id AND ea.status = 'approved') AS student_count,
            COALESCE(sec.adviser_teacher_id, rcpt.teacher_id) AS teacher_id,
            (sec.adviser_teacher_id IS NOT NULL OR rcpt.is_adviser) AS is_adviser,
            t.first_name AS t_first, t.last_name AS t_last, t.email AS t_email, t.status AS t_status,
            lm.status AS last_status, lm.created_at AS last_at, lm.error AS last_error,
            lm.trigger AS last_trigger, lm.to_email AS last_to,
            ls.created_at AS last_sent_at
     FROM sections sec
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     LEFT JOIN LATERAL (
        SELECT se.teacher_id, BOOL_OR(se.role_type = 'adviser') AS is_adviser, COUNT(*) AS n
        FROM schedule_entries se
        WHERE se.section_id = sec.id AND se.school_year_id = sec.school_year_id AND se.teacher_id IS NOT NULL
        GROUP BY se.teacher_id
        ORDER BY BOOL_OR(se.role_type = 'adviser') DESC, COUNT(*) DESC, se.teacher_id
        LIMIT 1
     ) rcpt ON TRUE
     LEFT JOIN teachers t ON t.id = COALESCE(sec.adviser_teacher_id, rcpt.teacher_id)
     LEFT JOIN LATERAL (
        SELECT status, created_at, error, trigger, to_email FROM masterlist_emails
        WHERE section_id = sec.id AND school_year_id = sec.school_year_id
        ORDER BY created_at DESC, id DESC LIMIT 1
     ) lm ON TRUE
     LEFT JOIN LATERAL (
        SELECT created_at FROM masterlist_emails
        WHERE section_id = sec.id AND school_year_id = sec.school_year_id AND status = 'sent'
        ORDER BY created_at DESC, id DESC LIMIT 1
     ) ls ON TRUE
     WHERE sec.school_year_id = $1
     ORDER BY gl.sort_order, sec.name`,
    [yearId]
  );
  return result.rows.map((r) => ({
    sectionId: r.id,
    gradeLevel: r.grade_level_name,
    section: r.section_name,
    studentCount: r.student_count,
    recipient: r.teacher_id ? {
      teacherId: r.teacher_id,
      name: `${r.t_first} ${r.t_last}`,
      email: r.t_email,
      isAdviser: Boolean(r.is_adviser),
      active: r.t_status ? r.t_status === 'active' : true,
    } : null,
    lastStatus: r.last_status || null,
    lastAt: r.last_at || null,
    lastSentAt: r.last_sent_at || null,
    lastError: r.last_error || null,
    lastTrigger: r.last_trigger || null,
    lastTo: r.last_to || null,
  }));
}

async function logAttempt(db, row) {
  await db.query(
    `INSERT INTO masterlist_emails (section_id, school_year_id, teacher_id, to_email, student_count, status, trigger, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [row.sectionId, row.yearId, row.teacherId || null, row.to || null, row.studentCount || 0, row.status, row.trigger, row.error || null]
  );
}

/**
 * Builds and sends the email for one section.
 * @returns {{status: 'sent'|'failed'|'skipped', message: string, to?: string, studentCount: number}}
 */
async function sendSectionEmail({ section, year, trigger = 'auto', db = pool }) {
  const base = { sectionId: section.sectionId, yearId: year.id, trigger, studentCount: section.studentCount };
  const label = `${section.gradeLevel} – ${section.section}`;

  const fail = async (status, message, extra = {}) => {
    await logAttempt(db, { ...base, status, error: message, ...extra });
    return { status, message, studentCount: section.studentCount, ...(extra.to ? { to: extra.to } : {}) };
  };

  if (!section.recipient) return fail('skipped', `${label} has no teacher assigned yet. Add an adviser in Class Schedules.`);
  if (!section.recipient.email) return fail('skipped', `${section.recipient.name} has no email address on file.`, { teacherId: section.recipient.teacherId });
  if (section.studentCount === 0) return fail('skipped', `${label} has no enrolled learners yet.`, { teacherId: section.recipient.teacherId, to: section.recipient.email });

  try {
    const students = await sectionRoster(db, section.sectionId);
    const entries = await teacherEntries(db, section.recipient.teacherId, year.id);
    const teacherName = section.recipient.name;

    const attachments = [
      {
        filename: `MasterList_${slug(section.gradeLevel)}_${slug(section.section)}.pdf`,
        content: await masterListPdf({
          sectionName: section.section, gradeLevelName: section.gradeLevel,
          schoolYearLabel: year.label, students, adviserName: teacherName,
        }),
        contentType: 'application/pdf',
      },
      {
        filename: `Schedule_${slug(teacherName)}.pdf`,
        content: await teacherSchedulePdf({ teacherName, schoolYearLabel: year.label, entries }),
        contentType: 'application/pdf',
      },
    ];

    const role = section.recipient.isAdviser ? 'the class adviser' : 'one of the teachers';
    const intro = trigger === 'auto'
      ? `Enrollment for School Year ${year.label} has closed. As ${role} of ${label}, you will find the final master list of ${students.length} enrolled ${students.length === 1 ? 'learner' : 'learners'} attached to this email.`
      : `As ${role} of ${label}, you will find the current master list for School Year ${year.label} (${students.length} enrolled ${students.length === 1 ? 'learner' : 'learners'}) attached to this email.`;
    const mail = renderEmail({
      preheader: `Master list for ${label}: ${students.length} enrolled learners.`,
      heading: `Master list for ${label}`,
      greeting: `Good day, ${teacherName},`,
      paragraphs: [
        intro,
        'Your weekly teaching schedule for the same school year is attached as a second PDF.',
      ],
      steps: [
        'Check the master list against your class records.',
        'Tell the school office about any learner who is missing or listed in the wrong section.',
      ],
      notice: 'The master list contains learner and contact details. Please keep it confidential and do not forward it.',
    });

    await sendPdfsEmail({
      to: section.recipient.email,
      subject: `${SCHOOL}: Master list and schedule for ${label}`,
      text: mail.text, html: mail.html, attachments,
    });
    await logAttempt(db, { ...base, studentCount: students.length, teacherId: section.recipient.teacherId, to: section.recipient.email, status: 'sent' });
    return { status: 'sent', message: `Sent to ${section.recipient.email}.`, to: section.recipient.email, studentCount: students.length };
  } catch (err) {
    const message = err.status === 503 ? err.message : `Could not send: ${err.message}`;
    return fail('failed', message, { teacherId: section.recipient.teacherId, to: section.recipient.email });
  }
}

// Send now (admin button): one section, or all of them when sectionId is omitted.
async function sendNow({ year, sectionId = null, trigger = 'manual' }) {
  const sections = (await listSections(pool, year.id)).filter((s) => !sectionId || s.sectionId === Number(sectionId));
  const results = [];
  for (const section of sections) {
    const r = await sendSectionEmail({ section, year, trigger });
    results.push({ sectionId: section.sectionId, label: `${section.gradeLevel} – ${section.section}`, ...r });
  }
  return results;
}

function isDue(section, now = Date.now()) {
  if (section.lastSentAt) return false;                       // already delivered once
  if (!section.lastAt) return true;                           // never tried
  return now - new Date(section.lastAt).getTime() >= RETRY_AFTER_HOURS * 3600 * 1000;
}

/**
 * One scheduler pass: when enrollment has closed for the active school year
 * and the administrator has automatic emails on, send every section's list
 * that has not been delivered yet. Safe to call repeatedly or from several
 * server processes (an advisory lock keeps a single pass running).
 */
async function runScheduledSends({ now = new Date() } = {}) {
  const client = await pool.connect();
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(7203001) AS ok');
    if (!lock.rows[0].ok) return { ran: false, reason: 'busy', sent: 0 };
    try {
      const yr = await client.query(
        `SELECT id, label, opens_at, closes_at, is_active, enrollment_open, auto_email_lists
         FROM school_years WHERE is_active = TRUE LIMIT 1`
      );
      const year = yr.rows[0];
      if (!year) return { ran: false, reason: 'no_year', sent: 0 };
      if (!year.auto_email_lists) return { ran: false, reason: 'auto_off', sent: 0 };
      year.slots_full = await enrollmentIsFull(pool, year.id);
      if (computeEnrollment(year, now).state !== 'closed') return { ran: false, reason: 'enrollment_not_closed', sent: 0 };

      let sent = 0;
      for (const section of await listSections(pool, year.id)) {
        if (!isDue(section, now.getTime())) continue;
        // sections with nobody in them are not worth an email or a log row
        if (section.studentCount === 0) continue;
        const r = await sendSectionEmail({ section, year, trigger: 'auto' });
        if (r.status === 'sent') sent++;
      }
      return { ran: true, sent };
    } finally {
      await client.query('SELECT pg_advisory_unlock(7203001)').catch(() => {});
    }
  } finally {
    client.release();
  }
}

function startScheduler() {
  const tick = () => runScheduledSends().catch((err) => console.error('[master list email]', err.message));
  setTimeout(tick, 15 * 1000).unref();                        // shortly after start
  setInterval(tick, SCHEDULER_INTERVAL_MS).unref();           // then every hour
}

module.exports = { listSections, sendSectionEmail, sendNow, runScheduledSends, startScheduler, sectionRoster, teacherEntries };
