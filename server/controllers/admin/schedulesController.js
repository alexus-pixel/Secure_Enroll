const schedulesDb = require('../../db/admin/schedules');
const { sendDbError } = require('../../utils/dbErrors');
const settingsDb = require('../../db/admin/settings');
const pool = require('../../db/pool');
const { logAudit } = require('../../lib/audit');

// Every read endpoint on this page can be pointed at a specific
// past school year via ?schoolYearId=, for the "view a previous
// year, read-only" filter — falling back to whichever year is
// currently active when the param is omitted, which is what every
// existing caller already does.
async function resolveSchoolYear(req) {
  if (req.query.schoolYearId) {
    return { id: Number(req.query.schoolYearId) };
  }
  return settingsDb.getActiveSchoolYear();
}

/**
 * The school years, and the teachers who can be put on a period: read-only
 * lists the schedule screens need. They sit behind schedule.manage so the
 * registrar can run the schedules without also being able to change the
 * school's settings or edit teacher records.
 */
async function scheduleSchoolYears(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT id, label, opens_at, closes_at, is_active, enrollment_open, dates_confirmed,
              (closes_at <= CURRENT_DATE) AS is_ended
       FROM school_years ORDER BY opens_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load the school years.' });
  }
}

async function scheduleTeachers(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, middle_name, is_active, status, max_periods_per_day
       FROM teachers
       WHERE is_active AND status = 'active'
       ORDER BY last_name, first_name`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load the teachers.' });
  }
}

async function gradeSummary(req, res) {
  try {
    const year = await resolveSchoolYear(req);
    if (!year) return res.status(404).json({ message: 'No active school year is set.' });
    res.json(await schedulesDb.listGradeScheduleSummary(year.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load schedules.' });
  }
}

async function sectionsForGrade(req, res) {
  try {
    const year = await resolveSchoolYear(req);
    if (!year) return res.status(404).json({ message: 'No active school year is set.' });
    res.json(await schedulesDb.listSectionsForGrade(req.params.gradeLevelId, year.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load sections.' });
  }
}

async function subjectsForGrade(req, res) {
  try {
    const year = await resolveSchoolYear(req);
    if (!year) return res.status(404).json({ message: 'No active school year is set.' });
    res.json(await schedulesDb.listSubjects(req.params.gradeLevelId, year.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load subjects.' });
  }
}

async function allSubjects(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });
    res.json(await schedulesDb.listAllSubjects(activeYear.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load subjects.' });
  }
}

// A rule the admin broke rather than a fault: the reply carries the
// reason code the UI switches on plus the numbers behind the message
// (the grade's limit, how many subjects it has), so the panel can say
// "Grade 3 is already at its limit of 10 subjects" without parsing
// prose or asking again.
function sendRuleError(err, res) {
  if (!err.status) return false;
  res.status(err.status).json({
    message: err.message,
    ...(err.reason ? { reason: err.reason } : {}),
    ...(err.details || {}),
  });
  return true;
}

// Everything the subject panel on the grade's schedule page needs:
// the grade's subjects (with how many periods and teachers each one
// is tied to), the per-grade limit, and the live count.
async function subjectSettings(req, res) {
  try {
    const year = await resolveSchoolYear(req);
    if (!year) return res.status(404).json({ message: 'No active school year is set.' });
    const settings = await schedulesDb.getSubjectSettings(req.params.gradeLevelId, year.id);
    if (settings.notFound) return res.status(404).json({ message: 'That grade level does not exist.' });
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load subjects.' });
  }
}

async function createSubject(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });
    const result = await schedulesDb.createSubject({ ...req.body, schoolYearId: activeYear.id });
    await logAudit(req.user.id, 'SUBJECT_CREATED', 'subject', result.subject.id, req, {
      name: result.subject.name, gradeLevelId: req.body.gradeLevelId, isDomain: result.subject.is_domain,
    });
    res.status(201).json({ ...result.subject, count: result.count, maxSubjects: result.maxSubjects });
  } catch (err) {
    if (sendRuleError(err, res)) return;
    if (sendDbError(err, res)) return;
    if (err.code === '23505') return res.status(409).json({ message: 'That subject already exists for this grade level.', reason: 'duplicate_subject_name' });
    console.error(err);
    res.status(500).json({ message: 'Could not create subject.' });
  }
}

// Renaming (and switching a subject to or from a learning domain)
// stays allowed while the subject is on the timetable — the periods
// point at its id, so they simply show the new name.
async function updateSubject(req, res) {
  try {
    const result = await schedulesDb.updateSubject(Number(req.params.id), req.body);
    if (result.notFound) return res.status(404).json({ message: 'Subject not found.' });
    await logAudit(req.user.id, 'SUBJECT_UPDATED', 'subject', Number(req.params.id), req, {
      from: { name: result.before.name, isDomain: result.before.is_domain },
      to: { name: result.subject.name, isDomain: result.subject.is_domain },
    });
    res.json(result.subject);
  } catch (err) {
    if (sendRuleError(err, res)) return;
    if (sendDbError(err, res)) return;
    if (err.code === '23505') return res.status(409).json({ message: 'That subject already exists for this grade level.', reason: 'duplicate_subject_name' });
    console.error(err);
    res.status(500).json({ message: 'Could not rename subject.' });
  }
}

async function deleteSubject(req, res) {
  try {
    const result = await schedulesDb.deleteSubject(Number(req.params.id));
    if (result.notFound) return res.status(404).json({ message: 'Subject not found.' });
    await logAudit(req.user.id, 'SUBJECT_REMOVED', 'subject', Number(req.params.id), req, {
      name: result.subject.name, teacherLinksRemoved: result.teacherLinksRemoved,
    });
    res.json({ removed: true, name: result.subject.name, teacherLinksRemoved: result.teacherLinksRemoved });
  } catch (err) {
    if (sendRuleError(err, res)) return;
    console.error(err);
    res.status(500).json({ message: 'Could not remove subject.' });
  }
}

// How many subjects this grade may have at all (1-20). The number is
// a property of the grade level itself, not of one school year, so
// the count it is checked against is the active year's.
async function setMaxSubjects(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });
    const result = await schedulesDb.setMaxSubjects(
      Number(req.params.gradeLevelId), req.body.maxSubjects, activeYear.id
    );
    if (result.notFound) return res.status(404).json({ message: 'That grade level does not exist.' });
    await logAudit(req.user.id, 'GRADE_MAX_SUBJECTS_CHANGED', 'grade_level', result.gradeLevelId, req, {
      gradeLevelName: result.gradeLevelName, from: result.previousMax, to: result.maxSubjects,
    });
    res.json(result);
  } catch (err) {
    if (sendRuleError(err, res)) return;
    if (sendDbError(err, res)) return;
    console.error(err);
    res.status(500).json({ message: 'Could not change the subject limit.' });
  }
}

/**
 * Who advises the section whose schedule is on screen. The adviser
 * is sections.adviser_teacher_id, set from School Settings — but the
 * registrar runs the schedules without being able to reach the
 * school-settings endpoints, so the read lives here, behind
 * schedule.manage, alongside /school-years and /teachers.
 *
 * Replies with adviserTeacherId: null and adviserName: null for a
 * section that has no adviser yet; the page shows "No adviser yet".
 */
async function sectionAdviser(req, res) {
  try {
    const year = await resolveSchoolYear(req);
    if (!year) return res.status(404).json({ message: 'No active school year is set.' });
    const result = await schedulesDb.getSectionAdviser(req.params.sectionId, year.id);
    if (result.notFound) return res.status(404).json({ message: 'Section not found.' });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load the section adviser.' });
  }
}

async function sectionSchedule(req, res) {
  try {
    const year = await resolveSchoolYear(req);
    if (!year) return res.status(404).json({ message: 'No active school year is set.' });
    res.json(await schedulesDb.getSectionWeeklySchedule(req.params.sectionId, year.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load the weekly schedule.' });
  }
}

/**
 * Live-availability check for the Add Subject Schedule panel: as
 * the admin picks a teacher, session, day(s) and time, this tells
 * the UI whether that combination is free — without saving
 * anything. It runs the exact same conflict query the real save
 * path uses, so "available" here always means "would also be
 * available on save" (short of a genuine race, which the save
 * path's advisory lock still catches).
 */
async function checkConflict(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });
    const days = req.query.days.split(',').map(Number);
    const conflict = await schedulesDb.findTeacherConflict(pool, {
      teacherId: req.query.teacherId,
      schoolYearId: activeYear.id,
      days,
      startTime: req.query.startTime,
      endTime: req.query.endTime,
      excludeEntryId: req.query.excludeEntryId,
    });
    if (conflict) return res.json({ available: false, reason: 'conflict', conflict });

    // A teacher already at their daily cap for one of these days
    // shouldn't show as pickable just because this particular time
    // slot happens to be free — they're still at capacity for
    // that day, only reachable by first raising their limit or
    // freeing up a period elsewhere.
    const dailyCapExceeded = await schedulesDb.checkDailyCap(pool, req.query.teacherId, activeYear.id, days, req.query.excludeEntryId);
    if (dailyCapExceeded) return res.json({ available: false, reason: 'daily_cap', dailyCapExceeded });

    res.json({ available: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not check availability.' });
  }
}

function conflictMessage(conflict) {
  const dayNames = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };
  const days = (conflict.days || []).map((d) => dayNames[d]).join('/');
  return `Already teaching ${conflict.grade_level_name} · ${conflict.section_name} `
    + `(${conflict.subject_name || 'a class'}) on ${days}, `
    + `${conflict.start_time?.slice(0, 5)}\u2013${conflict.end_time?.slice(0, 5)}.`;
}

function dailyCapMessage(x) {
  const dayNames = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday' };
  // Two different ceilings can bind: the teacher's own limit, or the number of
  // periods the day actually runs. Saying which one it is saves a guess.
  if (x.daySlots && x.teacherCap && x.daySlots < x.teacherCap) {
    return `${dayNames[x.day]} only runs ${x.daySlots} period${x.daySlots === 1 ? '' : 's'}, `
      + `and this teacher already has ${x.current} of them. Add another period to the day first.`;
  }
  return `This teacher is already at their daily limit on ${dayNames[x.day]} `
    + `(${x.current}/${x.cap} periods).`;
}

function duplicateSubjectMessage(duplicateSubject) {
  const dayNames = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };
  const days = (duplicateSubject.days || []).map((d) => dayNames[d]).join('/');
  return `This subject is already scheduled for this section on ${days}, `
    + `${duplicateSubject.start_time?.slice(0, 5)}\u2013${duplicateSubject.end_time?.slice(0, 5)}.`;
}

// A period whose time sits in the other half of the day from the
// session it was filed under. The reply names the session and the
// times, and which field is at fault, so the drawer can mark that
// field instead of only showing a banner.
function sendSessionMismatch(mismatch, res) {
  return res.status(409).json({
    message: mismatch.message,
    reason: 'session_time_mismatch',
    field: mismatch.field,
    session: mismatch.session,
    startTime: mismatch.startTime,
    endTime: mismatch.endTime,
    errors: [{ field: mismatch.field, message: mismatch.message }],
  });
}

async function createEntry(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });

    const result = await schedulesDb.createScheduleEntry({
      ...req.body, schoolYearId: activeYear.id, createdBy: req.user.id,
    });
    if (result.sessionMismatch) return sendSessionMismatch(result.sessionMismatch, res);
    if (result.duplicateSubject) {
      return res.status(409).json({ message: duplicateSubjectMessage(result.duplicateSubject) });
    }
    if (result.conflict) {
      return res.status(409).json({ message: conflictMessage(result.conflict), conflict: result.conflict });
    }
    if (result.dailyCapExceeded) {
      return res.status(409).json({ message: dailyCapMessage(result.dailyCapExceeded) });
    }
    if (result.overLoad) {
      return res.status(409).json({
        message: `This teacher is already at their weekly load cap (${result.overLoad.current}/${result.overLoad.cap} periods).`,
      });
    }
    await logAudit(req.user.id, 'SCHEDULE_ENTRY_CREATED', 'schedule_entry', result.entry.id, req, req.body);
    res.status(201).json(result.entry);
  } catch (err) {
    if (sendDbError(err, res)) return;
    if (sendRuleError(err, res)) return;
    console.error(err);
    res.status(500).json({ message: 'Could not save the schedule entry.' });
  }
}

async function updateEntry(req, res) {
  try {
    const result = await schedulesDb.updateScheduleEntry(Number(req.params.id), req.body);
    if (result.notFound) return res.status(404).json({ message: 'Schedule entry not found.' });
    if (result.sessionMismatch) return sendSessionMismatch(result.sessionMismatch, res);
    if (result.duplicateSubject) {
      return res.status(409).json({ message: duplicateSubjectMessage(result.duplicateSubject) });
    }
    if (result.conflict) {
      return res.status(409).json({ message: conflictMessage(result.conflict), conflict: result.conflict });
    }
    if (result.dailyCapExceeded) {
      return res.status(409).json({ message: dailyCapMessage(result.dailyCapExceeded) });
    }
    if (result.overLoad) {
      return res.status(409).json({
        message: `This teacher is already at their weekly load cap (${result.overLoad.current}/${result.overLoad.cap} periods).`,
      });
    }
    await logAudit(req.user.id, 'SCHEDULE_ENTRY_UPDATED', 'schedule_entry', Number(req.params.id), req, req.body);
    res.json(result.entry);
  } catch (err) {
    if (sendDbError(err, res)) return;
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    res.status(500).json({ message: 'Could not update the schedule entry.' });
  }
}

async function deleteEntry(req, res) {
  try {
    await schedulesDb.deleteScheduleEntry(Number(req.params.id));
    await logAudit(req.user.id, 'SCHEDULE_ENTRY_REMOVED', 'schedule_entry', Number(req.params.id), req);
    res.status(204).end();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    res.status(500).json({ message: 'Could not remove the schedule entry.' });
  }
}

async function teacherAssignments(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });
    res.json(await schedulesDb.getTeacherAssignments(req.params.teacherId, activeYear.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load assignments.' });
  }
}

module.exports = {
  scheduleSchoolYears, scheduleTeachers,
  gradeSummary, sectionsForGrade, subjectsForGrade, subjectSettings, allSubjects,
  createSubject, updateSubject, deleteSubject, setMaxSubjects,
  sectionSchedule, sectionAdviser, checkConflict, createEntry, updateEntry, deleteEntry, teacherAssignments,
};