const pool = require('../../db/pool');
const teachersDb = require('../../db/admin/teachers');
const settingsDb = require('../../db/admin/settings');
const usersDb = require('../../db/admin/users');
const { logAudit } = require('../../lib/audit');
const { teacherSchedulePdf, masterListPdf } = require('../../lib/pdf');
const { sendPdfsEmail } = require('../../lib/mailer');

async function list(req, res) {
  try {
    res.json(await teachersDb.listTeachers(req.query.search));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load teachers.' });
  }
}

async function detail(req, res) {
  try {
    const teacher = await teachersDb.getTeacherById(req.params.id);
    if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
    res.json(teacher);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load teacher.' });
  }
}

async function create(req, res) {
  const client = await pool.connect();
  try {
    const existing = await teachersDb.findTeacherByEmail(req.body.email);
    if (existing) return res.status(409).json({ message: 'A teacher with that email already exists.' });

    await client.query('BEGIN');
    const teacher = await teachersDb.createTeacher(client, { ...req.body, createdBy: req.user.id });
    await teachersDb.setTeacherSubjects(client, teacher.id, req.body.subjectIds || []);
    await client.query('COMMIT');

    await logAudit(req.user.id, 'TEACHER_CREATED', 'teacher', teacher.id, req, { email: teacher.email });
    res.status(201).json(teacher);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ message: 'Could not create teacher.' });
  } finally {
    client.release();
  }
}

async function update(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await teachersDb.updateTeacher(client, req.params.id, req.body);
    if (req.body.subjectIds !== undefined) {
      await teachersDb.setTeacherSubjects(client, req.params.id, req.body.subjectIds);
    }
    await client.query('COMMIT');
    if (!updated) return res.status(404).json({ message: 'Teacher not found.' });

    await logAudit(req.user.id, 'TEACHER_UPDATED', 'teacher', Number(req.params.id), req);
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ message: 'Could not update teacher.' });
  } finally {
    client.release();
  }
}

async function schedule(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });
    const entries = await teachersDb.getTeacherWeeklySchedule(req.params.id, activeYear.id);
    res.json({ entries, weeklyLoadCap: teachersDb.WEEKLY_LOAD_CAP });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load schedule.' });
  }
}

/**
 * "Send PDF" per the flow doc: emails the ADMIN (not the teacher)
 * a PDF of the master list for each section the teacher handles,
 * plus their schedule PDF. Requires SMTP_* to be set — see
 * lib/mailer.js — and fails with a clear 503 (not a silent
 * no-op) if it isn't.
 */
async function sendPdf(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });

    const teacher = await teachersDb.getTeacherById(req.params.id);
    if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });

    const entries = await teachersDb.getTeacherWeeklySchedule(req.params.id, activeYear.id);
    const teacherName = `${teacher.first_name} ${teacher.last_name}`;

    const attachments = [{
      filename: `${teacherName.replace(/\s+/g, '_')}_Schedule.pdf`,
      content: await teacherSchedulePdf({ teacherName, schoolYearLabel: activeYear.label, entries }),
    }];

    const sectionIds = [...new Set(entries.map((e) => e.section_id).filter(Boolean))];
    for (const sectionId of sectionIds) {
      const rosterResult = await pool.query(
        `SELECT s.first_name, s.last_name,
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
      const sectionRow = entries.find((e) => e.section_id === sectionId);
      attachments.push({
        filename: `MasterList_Section_${sectionId}.pdf`,
        content: await masterListPdf({
          sectionName: sectionRow?.section_name || `Section ${sectionId}`,
          gradeLevelName: sectionRow?.grade_level_name || '',
          schoolYearLabel: activeYear.label,
          students: rosterResult.rows,
        }),
      });
    }

    await sendPdfsEmail({
      to: (await usersDb.findUserById(req.user.id))?.email,
      subject: `SecureEnroll — ${teacherName}'s master list and schedule`,
      text: `Attached: the master list for each section ${teacherName} handles, and their weekly schedule.`,
      attachments,
    });

    await logAudit(req.user.id, 'TEACHER_PDF_SENT', 'teacher', Number(req.params.id), req);
    res.json({ sent: true });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || 'Could not send the PDF.' });
  }
}

module.exports = { list, detail, create, update, schedule, sendPdf };
