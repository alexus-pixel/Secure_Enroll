const pool = require('../../db/pool');
const teachersDb = require('../../db/admin/teachers');
const settingsDb = require('../../db/admin/settings');
const { logAudit } = require('../../lib/audit');
const { teacherSchedulePdf, masterListPdf } = require('../../lib/pdf');
const { sendPdfsEmail } = require('../../lib/mailer');
const { verifyEmailExists } = require('../../lib/emailVerification');
const { degreeOptions: getDegreeOptions } = require('../../lib/degreeReference');

function duplicateMessage(duplicate) {
  if (duplicate.field === 'name') {
    return `A teacher named ${duplicate.existing.first_name} ${duplicate.existing.last_name} already exists.`;
  }
  if (duplicate.field === 'prcLicenseNumber') {
    return `That PRC license number is already on file for ${duplicate.existing.first_name} ${duplicate.existing.last_name}.`;
  }
  return 'A teacher with that contact number already exists.';
}

async function checkEmail(req, res) {
  const result = await verifyEmailExists(req.query.email);
  res.json(result);
}

async function list(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    res.json(await teachersDb.listTeachers(req.query.search, activeYear?.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load teachers.' });
  }
}

async function degreeOptions(req, res) {
  res.json(getDegreeOptions());
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

    const duplicate = await teachersDb.findDuplicateTeacher({
      firstName: req.body.firstName, lastName: req.body.lastName, contactNumber: req.body.contactNumber,
      prcLicenseNumber: req.body.prcLicenseNumber,
    });
    if (duplicate) return res.status(409).json({ message: duplicateMessage(duplicate) });

    const emailCheck = await verifyEmailExists(req.body.email);
    if (!emailCheck.ok) return res.status(422).json({ message: emailCheck.reason });

    await client.query('BEGIN');
    const teacher = await teachersDb.createTeacher(client, { ...req.body, createdBy: req.user.id });
    await teachersDb.setTeacherSubjects(client, teacher.id, req.body.subjectIds || []);
    await client.query('COMMIT');

    await logAudit(req.user.id, 'TEACHER_CREATED', 'teacher', teacher.id, req, {
      email: teacher.email, emailVerified: emailCheck.checked,
    });
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
  try {
    const existing = await teachersDb.getTeacherById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Teacher not found.' });

    if (req.body.email !== undefined && req.body.email !== existing.email) {
      const emailCheck = await verifyEmailExists(req.body.email);
      if (!emailCheck.ok) return res.status(422).json({ message: emailCheck.reason });
    }

    // Duplicate check runs against the *merged* identity (existing
    // values plus whatever this request is actually changing) —
    // editing only the contact number, say, still needs the current
    // name carried forward, or it would check "" against everyone
    // else's name instead of this teacher's real one.
    const duplicate = await teachersDb.findDuplicateTeacher({
      firstName: req.body.firstName ?? existing.first_name,
      lastName: req.body.lastName ?? existing.last_name,
      contactNumber: req.body.contactNumber ?? existing.contact_number,
      prcLicenseNumber: req.body.prcLicenseNumber ?? existing.prc_license_number,
      excludeId: Number(req.params.id),
    });
    if (duplicate) return res.status(409).json({ message: duplicateMessage(duplicate) });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await teachersDb.updateTeacher(client, req.params.id, req.body);
      if (req.body.subjectIds !== undefined) {
        await teachersDb.setTeacherSubjects(client, req.params.id, req.body.subjectIds);
      }
      await client.query('COMMIT');
      if (!updated) return res.status(404).json({ message: 'Teacher not found.' });

      await logAudit(req.user.id, 'TEACHER_UPDATED', 'teacher', Number(req.params.id), req, {
        clearedSchedules: updated.clearedSchedules || 0,
      });
      res.json(updated);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    res.status(500).json({ message: 'Could not update teacher.' });
  }
}

async function schedule(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });
    const teacher = await teachersDb.getTeacherById(req.params.id);
    if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
    const entries = await teachersDb.getTeacherWeeklySchedule(req.params.id, activeYear.id);
    res.json({ entries, weeklyLoadCap: teacher.max_periods_per_day * 5 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load schedule.' });
  }
}

/**
 * "Send PDF": emails the teacher themselves a PDF of the master
 * list for each section they handle, plus their own schedule PDF.
 * The master list per section is already wired to real enrollment
 * data (enrollment_applications/students/guardians) — it'll just
 * come back with zero students listed until the registrar side is
 * actually submitting real applications, since that's where this
 * data comes from.
 * Requires SMTP_* to be set — see lib/mailer.js — and fails with a
 * clear 503 (not a silent no-op) if it isn't.
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
      to: teacher.email,
      subject: `SecureEnroll \u2014 Your master list and schedule`,
      text: `Attached: the master list for each section you handle, and your weekly schedule.`,
      attachments,
    });

    await logAudit(req.user.id, 'TEACHER_PDF_SENT', 'teacher', Number(req.params.id), req);
    res.json({ sent: true });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || 'Could not send the PDF.' });
  }
}

module.exports = { list, degreeOptions, checkEmail, detail, create, update, schedule, sendPdf };