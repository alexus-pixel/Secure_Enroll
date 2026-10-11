const schedulesDb = require('../../db/admin/schedules');
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

async function createSubject(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });
    const subject = await schedulesDb.createSubject({ ...req.body, schoolYearId: activeYear.id });
    await logAudit(req.user.id, 'SUBJECT_CREATED', 'subject', subject.id, req, { name: subject.name });
    res.status(201).json(subject);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'That subject already exists for this grade level.' });
    console.error(err);
    res.status(500).json({ message: 'Could not create subject.' });
  }
}

async function deleteSubject(req, res) {
  try {
    await schedulesDb.deleteSubject(req.params.id);
    await logAudit(req.user.id, 'SUBJECT_REMOVED', 'subject', Number(req.params.id), req);
    res.status(204).end();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    res.status(500).json({ message: 'Could not remove subject.' });
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

function dailyCapMessage(dailyCapExceeded) {
  const dayNames = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday' };
  return `This teacher is already at their daily limit on ${dayNames[dailyCapExceeded.day]} `
    + `(${dailyCapExceeded.current}/${dailyCapExceeded.cap} periods).`;
}

function duplicateSubjectMessage(duplicateSubject) {
  const dayNames = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };
  const days = (duplicateSubject.days || []).map((d) => dayNames[d]).join('/');
  return `This subject is already scheduled for this section on ${days}, `
    + `${duplicateSubject.start_time?.slice(0, 5)}\u2013${duplicateSubject.end_time?.slice(0, 5)}.`;
}

async function createEntry(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });

    const result = await schedulesDb.createScheduleEntry({
      ...req.body, schoolYearId: activeYear.id, createdBy: req.user.id,
    });
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
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    res.status(500).json({ message: 'Could not save the schedule entry.' });
  }
}

async function updateEntry(req, res) {
  try {
    const result = await schedulesDb.updateScheduleEntry(Number(req.params.id), req.body);
    if (result.notFound) return res.status(404).json({ message: 'Schedule entry not found.' });
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
  gradeSummary, sectionsForGrade, subjectsForGrade, allSubjects, createSubject, deleteSubject,
  sectionSchedule, checkConflict, createEntry, updateEntry, deleteEntry, teacherAssignments,
};