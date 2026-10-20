const pool = require('../../db/pool');
const { sendDbError } = require('../../utils/dbErrors');
const teachersDb = require('../../db/admin/teachers');
const settingsDb = require('../../db/admin/settings');
const { logAudit } = require('../../lib/audit');
const { teacherSchedulePdf, masterListPdf } = require('../../lib/pdf');
const { sendPdfsEmail } = require('../../lib/mailer');
const masterListMail = require('../../lib/masterListMail');
const { renderEmail } = require('../../utils/emailTemplate');
const { checkEmailAcceptable } = require('../../lib/emailGate');

// A teacher's address may sit on the school's own domain rather than Gmail, so
// the Gmail requirement is lifted here — everything else about the gate holds:
// the domain is one the school's mail reaches, the mailbox is not dead, and
// Brevo is not refusing it.
const checkTeacherEmail = (email) => checkEmailAcceptable(email, { requireGmail: false });
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
  const result = await checkTeacherEmail(req.query.email);
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
    // lockedSubjects lets the edit form grey out the subjects this
    // teacher is still scheduled for, with the reason, instead of
    // letting the admin untick one and only then hit the 409.
    const activeYear = await settingsDb.getActiveSchoolYear();
    const lockedSubjects = await teachersDb.getLockedSubjects(teacher.id, activeYear?.id);
    res.json({ ...teacher, lockedSubjects });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load teacher.' });
  }
}

async function create(req, res) {
  const client = await pool.connect();
  try {
    // A teacher may have no email address on file at all, in which
    // case there is nothing to check for duplicates or to verify.
    if (req.body.email) {
      const existing = await teachersDb.findTeacherByEmail(req.body.email);
      if (existing) return res.status(409).json({ message: 'A teacher with that email already exists.' });
    }

    const duplicate = await teachersDb.findDuplicateTeacher({
      firstName: req.body.firstName, lastName: req.body.lastName, contactNumber: req.body.contactNumber,
      prcLicenseNumber: req.body.prcLicenseNumber,
    });
    if (duplicate) return res.status(409).json({ message: duplicateMessage(duplicate) });

    const emailCheck = req.body.email
      ? await checkTeacherEmail(req.body.email)
      : { checked: false, ok: true };
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
    if (sendDbError(err, res)) return;
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

    if (req.body.email && req.body.email !== existing.email) {
      const emailCheck = await checkTeacherEmail(req.body.email);
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

    const activeYear = await settingsDb.getActiveSchoolYear();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await teachersDb.updateTeacher(client, req.params.id, req.body);
      if (req.body.subjectIds !== undefined) {
        await teachersDb.setTeacherSubjects(client, req.params.id, req.body.subjectIds, activeYear?.id);
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
    if (sendDbError(err, res)) return;
    if (err.status) {
      return res.status(err.status).json({
        message: err.message,
        ...(err.reason ? { reason: err.reason } : {}),
        ...(err.lockedSubjects ? { lockedSubjects: err.lockedSubjects } : {}),
      });
    }
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
 * "Send PDF": emails the teacher their own weekly schedule plus the master
 * list of every section they handle, in the school's blue-header layout.
 * Requires SMTP_* to be set (see lib/mailer.js) and fails with a clear 503,
 * not a silent no-op, if it isn't.
 */
async function sendPdf(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });

    const teacher = await teachersDb.getTeacherById(req.params.id);
    if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
    if (!teacher.email) return res.status(422).json({ message: 'This teacher has no email address on file. Add one before sending.' });

    const entries = await masterListMail.teacherEntries(pool, teacher.id, activeYear.id);
    const teacherName = `${teacher.first_name} ${teacher.last_name}`;

    const attachments = [{
      filename: `${teacherName.replace(/\s+/g, '_')}_Schedule.pdf`,
      content: await teacherSchedulePdf({ teacherName, schoolYearLabel: activeYear.label, entries }),
    }];

    const seen = new Set();
    for (const e of entries) {
      if (!e.section_id || seen.has(e.section_id)) continue;
      seen.add(e.section_id);
      const adviserOf = entries.some((x) => x.section_id === e.section_id && x.role_type === 'adviser');
      attachments.push({
        filename: `MasterList_${e.grade_level_name}_${e.section_name}.pdf`.replace(/\s+/g, '_'),
        content: await masterListPdf({
          sectionName: e.section_name, gradeLevelName: e.grade_level_name,
          schoolYearLabel: activeYear.label,
          students: await masterListMail.sectionRoster(pool, e.section_id),
          adviserName: adviserOf ? teacherName : undefined,
        }),
      });
    }

    const mail = renderEmail({
      preheader: 'Your class master lists and weekly schedule.',
      heading: 'Your master lists and weekly schedule',
      greeting: `Good day, ${teacherName},`,
      paragraphs: [
        `Attached are the master list for each section you handle and your weekly schedule for School Year ${activeYear.label}.`,
      ],
      notice: 'The master lists contain learner and contact details. Please keep them confidential.',
    });
    await sendPdfsEmail({
      to: teacher.email,
      subject: 'Caloocan City Elementary School: Your class master lists and weekly schedule',
      text: mail.text, html: mail.html, attachments,
    });

    await logAudit(req.user.id, 'TEACHER_PDF_SENT', 'teacher', Number(req.params.id), req);
    res.json({ sent: true });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || 'Could not send the PDF.' });
  }
}

function teacherName(t) {
  return `${t.first_name} ${t.last_name}`;
}

/**
 * What a hand-over away from this teacher is still waiting to give
 * back, so the Activate dialog can ask about it before anything is
 * changed. { pending: false } when there is nothing to offer.
 */
async function pendingTransfer(req, res) {
  try {
    const teacherId = Number(req.params.id);
    const teacher = await teachersDb.getTeacherById(teacherId);
    if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
    const activeYear = await settingsDb.getActiveSchoolYear();
    const transfer = await teachersDb.getPendingTransfer(teacherId, activeYear?.id);
    if (!transfer) return res.json({ pending: false });
    res.json({ pending: true, transfer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not check this teacher\u2019s transferred schedule.' });
  }
}

// "2 periods moved back to Maria Santos from Juan Delacruz. 1 was
// skipped." — the sentence the Teachers list shows after activating.
function restoreMessage(name, restore) {
  const parts = [];
  const n = restore.restoredCount;
  parts.push(n === 0
    ? `Nothing could be moved back to ${name} from ${restore.toTeacherName}.`
    : `${n} class assignment${n === 1 ? '' : 's'} moved back to ${name} from ${restore.toTeacherName}.`);
  for (const clash of restore.clashes) {
    parts.push(`${clash.label} was not moved back: ${name} is already teaching `
      + `${clash.existingSubject} for ${clash.existing}, which clashes with it.`);
  }
  if (restore.skipped.length > 0) {
    parts.push(`${restore.skipped.length} was not moved back because `
      + `${restore.skipped.map((s) => `${s.label} \u2014 ${s.note}`).join('; ')}.`);
  }
  return parts.join(' ');
}

/**
 * The Activate / Deactivate button on the Teachers list.
 *
 * Reactivating is always allowed. Deactivating is refused for as
 * long as the teacher still has anything on the active school
 * year's timetable — a class with a deactivated teacher in front of
 * it is nobody's class — so the refusal lists every period and
 * adviser role still assigned, and the admin has to transfer them
 * to another teacher first.
 *
 * Reactivating with restoreSchedule: true also undoes the hand-over
 * that made the deactivation possible — the periods that are still
 * exactly as they were moved come back, and the rest are reported.
 * It is opt-in: the dialog asks, because by now somebody else may
 * have been teaching those classes for weeks.
 */
async function setActive(req, res) {
  const client = await pool.connect();
  try {
    const teacherId = Number(req.params.id);
    const teacher = await teachersDb.getTeacherById(teacherId);
    if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });

    const isActive = req.body.isActive;
    const activeYear = await settingsDb.getActiveSchoolYear();

    if (!isActive) {
      const assignments = await teachersDb.getActiveYearAssignments(teacherId, activeYear?.id);
      if (assignments.length > 0) {
        const one = assignments.length === 1;
        return res.status(409).json({
          reason: 'has_schedule',
          message: `${teacherName(teacher)} still has ${assignments.length} class `
            + `${one ? 'assignment' : 'assignments'} this school year: `
            + `${assignments.map((a) => a.label).join('; ')}. Transfer the schedule and subjects `
            + 'to another teacher before deactivating.',
          assignments,
        });
      }
    }

    // Activating the teacher and giving their classes back is one
    // transaction: the roster never shows a teacher who is active with
    // half of their timetable handed back.
    await client.query('BEGIN');
    const updated = await teachersDb.setTeacherActive(client, teacherId, isActive);
    if (!updated) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Teacher not found.' });
    }
    let restore = null;
    if (isActive && req.body.restoreSchedule) {
      restore = await teachersDb.restoreTransfer(client, teacherId, activeYear?.id);
    }
    await client.query('COMMIT');

    await logAudit(
      req.user.id, isActive ? 'TEACHER_REACTIVATED' : 'TEACHER_DEACTIVATED',
      'teacher', teacherId, req, {
        name: teacherName(teacher),
        ...(restore ? {
          restoredCount: restore.restoredCount, skipped: restore.skipped.length,
          clashes: restore.clashes.length, fromTeacherId: restore.toTeacherId,
        } : {}),
      }
    );
    if (restore) {
      await logAudit(req.user.id, 'TEACHER_SCHEDULE_RESTORED', 'teacher', teacherId, req, {
        from: restore.toTeacherName, restoredCount: restore.restoredCount,
        skipped: restore.skipped, clashes: restore.clashes.map((c) => c.label),
      });
    }
    res.json({
      ...updated,
      ...(restore ? { restore: { ...restore, message: restoreMessage(teacherName(teacher), restore) } } : {}),
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
    if (sendDbError(err, res)) return;
    console.error(err);
    res.status(500).json({ message: 'Could not change this teacher\u2019s status.' });
  } finally {
    client.release();
  }
}

/**
 * Hands every one of this teacher's active-year schedule entries to
 * another teacher in one transaction, together with the
 * teacher_subjects links those periods need. Refused if the
 * receiving teacher would end up double-booked — the reply names
 * the period that clashes rather than silently dropping it.
 */
async function transferSchedule(req, res) {
  const client = await pool.connect();
  try {
    const fromId = Number(req.params.id);
    const toId = Number(req.body.toTeacherId);
    if (fromId === toId) {
      return res.status(422).json({ message: 'Choose a different teacher to transfer to.' });
    }

    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });

    const from = await teachersDb.getTeacherById(fromId);
    if (!from) return res.status(404).json({ message: 'Teacher not found.' });
    const to = await teachersDb.getTeacherById(toId);
    if (!to) return res.status(404).json({ message: 'The teacher to transfer to was not found.' });
    if (!to.is_active || to.status === 'retired') {
      return res.status(422).json({
        message: `${teacherName(to)} is not an active teacher, so the schedule cannot be transferred to them.`,
      });
    }

    const assignments = await teachersDb.getActiveYearAssignments(fromId, activeYear.id);
    if (assignments.length === 0) {
      return res.status(409).json({
        reason: 'nothing_to_transfer',
        message: `${teacherName(from)} has no class assignments this school year to transfer.`,
      });
    }

    await client.query('BEGIN');
    const clash = await teachersDb.findTransferClash(client, fromId, toId, activeYear.id);
    if (clash) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        reason: 'time_clash',
        message: `${teacherName(to)} is already teaching ${clash.existingSubject} for `
          + `${clash.existing}, which clashes with ${clash.movingSubject} for ${clash.moving}. `
          + 'Move or re-time that period before transferring.',
        clash,
      });
    }

    const result = await teachersDb.transferSchedule(client, fromId, toId, activeYear.id, req.user.id);
    await client.query('COMMIT');

    await logAudit(req.user.id, 'TEACHER_SCHEDULE_TRANSFERRED', 'teacher', fromId, req, {
      from: teacherName(from), to: teacherName(to), toTeacherId: toId,
      movedCount: result.movedCount, subjectIds: result.subjectIds,
    });
    res.json({
      movedCount: result.movedCount,
      subjectsLinked: result.subjectIds.length,
      toTeacherId: toId,
      toTeacherName: teacherName(to),
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
    if (sendDbError(err, res)) return;
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    res.status(500).json({ message: 'Could not transfer the schedule.' });
  } finally {
    client.release();
  }
}

/**
 * What would have to be handed over before this teacher can be deactivated,
 * and who could take each piece on. The dialog is built from this.
 */
async function handoverPreview(req, res) {
  try {
    const teacherId = Number(req.params.id);
    const teacher = await teachersDb.getTeacherById(teacherId);
    if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
    const activeYear = await settingsDb.getActiveSchoolYear();
    const work = await teachersDb.getHandoverWork(teacherId, activeYear?.id);
    const withCandidates = await teachersDb.getHandoverCandidates(teacherId, activeYear?.id, work);
    const stuck = [...withCandidates.subjects, ...withCandidates.advisories]
      .filter((item) => !item.candidates.some((c) => c.eligible))
      .map((item) => item.subjectName || `${item.gradeLevelName} — ${item.sectionName}`);
    res.json({
      teacherName: teacherName(teacher),
      ...withCandidates,
      nothingToHandOver: withCandidates.subjects.length === 0 && withCandidates.advisories.length === 0,
      // Named so the dialog can say what the obstacle is rather than
      // offering an empty dropdown with no explanation.
      blocked: stuck,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not work out what this teacher would hand over.' });
  }
}

/**
 * Hands the work over and deactivates the teacher, in one transaction: the
 * roster never shows a teacher as inactive while classes still have their
 * name against them.
 */
async function handover(req, res) {
  const client = await pool.connect();
  try {
    const teacherId = Number(req.params.id);
    const teacher = await teachersDb.getTeacherById(teacherId);
    if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(409).json({ message: 'No active school year is set.' });

    await client.query('BEGIN');
    const result = await teachersDb.performHandover(client, {
      teacherId,
      schoolYearId: activeYear.id,
      subjectChoices: req.body.subjects,
      adviserChoices: req.body.advisers,
      createdBy: req.user.id,
    });
    const updated = await teachersDb.setTeacherActive(client, teacherId, false);
    if (!updated) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Teacher not found.' });
    }
    await client.query('COMMIT');

    await logAudit(req.user.id, 'TEACHER_HANDOVER', 'teacher', teacherId, req, {
      name: teacherName(teacher),
      movedCount: result.movedCount,
      subjects: result.subjectsHandedOver,
      advisories: result.advisoriesHandedOver,
    });

    const parts = [];
    if (result.subjectsHandedOver) {
      parts.push(`${result.movedCount} class ${result.movedCount === 1 ? 'period' : 'periods'} across `
        + `${result.subjectsHandedOver} ${result.subjectsHandedOver === 1 ? 'subject' : 'subjects'}`);
    }
    if (result.advisoriesHandedOver) {
      parts.push(`${result.advisoriesHandedOver} advisory ${result.advisoriesHandedOver === 1 ? 'class' : 'classes'}`);
    }
    res.json({
      ...result,
      message: parts.length
        ? `${parts.join(' and ')} handed over. ${teacherName(teacher)} is now inactive.`
        : `${teacherName(teacher)} is now inactive.`,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.status && err.status < 500) {
      return res.status(err.status).json({
        message: err.message, ...(err.reason ? { reason: err.reason } : {}),
      });
    }
    console.error(err);
    res.status(500).json({ message: 'Could not hand this teacher’s classes over.' });
  } finally {
    client.release();
  }
}

module.exports = {
  list, degreeOptions, checkEmail, detail, create, update, schedule, sendPdf,
  setActive, transferSchedule, pendingTransfer, handoverPreview, handover,
};