const pool = require('../pool');
const { isSchoolYearEditable } = require('./schoolSettings');

async function assertSchoolYearEditable(schoolYearId) {
  const editable = await isSchoolYearEditable(schoolYearId);
  if (!editable) {
    const err = new Error('This school year has ended. Its schedule is now view-only.');
    err.status = 403;
    throw err;
  }
}

async function listGradeScheduleSummary(schoolYearId) {
  const result = await pool.query(
    `SELECT gl.id, gl.name, gl.sort_order,
            COUNT(DISTINCT sec.id)::int AS section_count,
            COUNT(DISTINCT sub.id)::int AS subject_count,
            COUNT(DISTINCT se.teacher_id)::int AS teacher_count,
            COUNT(DISTINCT se.id)::int AS filled_periods
     FROM grade_levels gl
     LEFT JOIN sections sec ON sec.grade_level_id = gl.id AND sec.school_year_id = $1
     LEFT JOIN subjects sub ON sub.grade_level_id = gl.id AND sub.school_year_id = $1
     LEFT JOIN schedule_entries se ON se.section_id = sec.id AND se.school_year_id = $1
     GROUP BY gl.id, gl.name, gl.sort_order
     ORDER BY gl.sort_order`,
    [schoolYearId]
  );
  return result.rows;
}

async function listSectionsForGrade(gradeLevelId, schoolYearId) {
  const result = await pool.query(
    `SELECT id, name FROM sections WHERE grade_level_id = $1 AND school_year_id = $2 ORDER BY name`,
    [gradeLevelId, schoolYearId]
  );
  return result.rows;
}

async function listSubjects(gradeLevelId, schoolYearId) {
  const result = await pool.query(
    `SELECT id, name, is_domain FROM subjects
     WHERE grade_level_id = $1 AND school_year_id = $2 ORDER BY is_domain DESC, name`,
    [gradeLevelId, schoolYearId]
  );
  return result.rows;
}

// Used by the Add Teacher form, which lets an admin tick subjects
// across any grade level rather than picking one grade first.
async function listAllSubjects(schoolYearId) {
  const result = await pool.query(
    `SELECT sub.id, sub.name, sub.is_domain, gl.id AS grade_level_id, gl.name AS grade_level_name
     FROM subjects sub
     JOIN grade_levels gl ON gl.id = sub.grade_level_id
     WHERE sub.school_year_id = $1
     ORDER BY gl.sort_order, sub.is_domain DESC, sub.name`,
    [schoolYearId]
  );
  return result.rows;
}

async function createSubject({ name, gradeLevelId, schoolYearId, isDomain }) {
  const result = await pool.query(
    `INSERT INTO subjects (name, grade_level_id, school_year_id, is_domain)
     VALUES ($1, $2, $3, $4) RETURNING id, name, is_domain`,
    [name, gradeLevelId, schoolYearId, isDomain]
  );
  return result.rows[0];
}

async function deleteSubject(id) {
  // Removing a subject that is actively scheduled would silently
  // orphan those schedule_entries rows (subject_id has no ON DELETE
  // rule of its own beyond the FK, so this would fail loudly
  // instead — which is what we want: force the admin to remove the
  // schedule entries first, not lose the record of what a class
  // was actually being taught).
  const inUse = await pool.query('SELECT 1 FROM schedule_entries WHERE subject_id = $1 LIMIT 1', [id]);
  if (inUse.rows.length > 0) {
    const err = new Error('This subject is still used in the schedule. Remove those periods first.');
    err.status = 409;
    throw err;
  }
  await pool.query('DELETE FROM subjects WHERE id = $1', [id]);
}

async function findBlankPeriodEntry(sectionId, schoolYearId, session, startTime, endTime) {
  const result = await pool.query(
    `SELECT id FROM schedule_entries
     WHERE section_id = $1 AND school_year_id = $2 AND session = $3
       AND start_time = $4 AND end_time = $5
       AND subject_id IS NULL AND teacher_id IS NULL AND days = '{}'
     LIMIT 1`,
    [sectionId, schoolYearId, session, startTime, endTime]
  );
  return result.rows[0]?.id || null;
}

async function getSectionWeeklySchedule(sectionId, schoolYearId) {
  const result = await pool.query(
    `SELECT se.id, se.session, se.days, se.start_time, se.end_time, se.room, se.role_type,
            sub.id AS subject_id, sub.name AS subject_name,
            t.id AS teacher_id, t.first_name AS teacher_first_name, t.last_name AS teacher_last_name
     FROM schedule_entries se
     LEFT JOIN subjects sub ON sub.id = se.subject_id
     LEFT JOIN teachers t ON t.id = se.teacher_id
     WHERE se.section_id = $1 AND se.school_year_id = $2
     ORDER BY se.start_time NULLS LAST`,
    [sectionId, schoolYearId]
  );
  return result.rows;
}

/**
 * The core rule from the proposal doc: a teacher's availability is
 * checked across the WHOLE school, not just the grade/section being
 * edited. Returns the conflicting entry (with enough context to
 * show "already teaching Grade 2 Mathematics Mon/Wed/Fri") or null.
 */
async function findTeacherConflict(db, { teacherId, schoolYearId, days, startTime, endTime, excludeEntryId }) {
  const result = await db.query(
    `SELECT se.id, sec.name AS section_name, gl.name AS grade_level_name,
            sub.name AS subject_name, se.days, se.start_time, se.end_time
     FROM schedule_entries se
     JOIN sections sec ON sec.id = se.section_id
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     LEFT JOIN subjects sub ON sub.id = se.subject_id
     WHERE se.teacher_id = $1
       AND se.school_year_id = $2
       AND se.role_type = 'subject'
       AND se.days && $3::smallint[]
       AND se.start_time < $5
       AND se.end_time > $4
       AND ($6::bigint IS NULL OR se.id <> $6)`,
    [teacherId, schoolYearId, days, startTime, endTime, excludeEntryId || null]
  );
  return result.rows[0] || null;
}

/**
 * A section shouldn't see the same subject twice in one day — two
 * Math periods on the same Monday almost always means a mistake,
 * not a deliberate double session, regardless of which teacher or
 * time slot each one uses. Scoped to the section (not the teacher),
 * since this is about the class's own timetable making sense, not
 * about anyone's availability.
 */
async function findDuplicateSubjectInSection(db, { sectionId, subjectId, schoolYearId, days, excludeEntryId }) {
  if (!subjectId) return null;
  const result = await db.query(
    `SELECT id, days, start_time, end_time FROM schedule_entries
     WHERE section_id = $1 AND subject_id = $2 AND school_year_id = $3
       AND role_type = 'subject' AND days && $4::smallint[]
       AND ($5::bigint IS NULL OR id <> $5)`,
    [sectionId, subjectId, schoolYearId, days, excludeEntryId || null]
  );
  return result.rows[0] || null;
}

async function getTeacherWeeklyLoad(db, teacherId, schoolYearId, excludeEntryId) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS count FROM schedule_entries
     WHERE teacher_id = $1 AND school_year_id = $2 AND role_type = 'subject'
       AND ($3::bigint IS NULL OR id <> $3)`,
    [teacherId, schoolYearId, excludeEntryId || null]
  );
  return result.rows[0].count;
}

// How many periods this teacher already teaches on one specific
// day (school-wide, any grade/section) — a single schedule_entries
// row can name several days at once (e.g. Mon+Wed+Fri in one row),
// so this counts rows where the day appears in that array, which is
// exactly "how many distinct periods land on this day", not how
// many rows exist overall.
async function getTeacherDailyLoad(db, teacherId, schoolYearId, day, excludeEntryId) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS count FROM schedule_entries
     WHERE teacher_id = $1 AND school_year_id = $2 AND role_type = 'subject'
       AND $3 = ANY(days)
       AND ($4::bigint IS NULL OR id <> $4)`,
    [teacherId, schoolYearId, day, excludeEntryId || null]
  );
  return result.rows[0].count;
}

async function getTeacherMaxPeriodsPerDay(db, teacherId) {
  const result = await db.query('SELECT max_periods_per_day FROM teachers WHERE id = $1', [teacherId]);
  return result.rows[0]?.max_periods_per_day ?? 5;
}

// Each teacher has their own editable daily cap (teachers.max_periods_per_day,
// default 5). A booking can span several days at once, so every day
// it touches gets checked; the first day that would be pushed over
// its cap is returned (with enough context for a clear message),
// not just a bare yes/no.
async function checkDailyCap(db, teacherId, schoolYearId, days, excludeEntryId) {
  const cap = await getTeacherMaxPeriodsPerDay(db, teacherId);
  for (const day of days) {
    const current = await getTeacherDailyLoad(db, teacherId, schoolYearId, day, excludeEntryId);
    if (current + 1 > cap) {
      return { day, current, cap };
    }
  }
  return null;
}

// The weekly cap isn't a separate fixed number — it's this same
// per-teacher daily cap applied across a 5-day school week. A
// teacher whose daily cap was raised to 7 should be able to carry a
// heavier week too (35, not a number disconnected from the setting
// that actually controls their schedule), and the "12/24 periods"
// shown on the Teachers list needs to be the exact same number this
// enforces against — otherwise the display would be lying about
// what the system actually allows.
const SCHOOL_DAYS_PER_WEEK = 5;
async function getTeacherWeeklyCap(db, teacherId) {
  return (await getTeacherMaxPeriodsPerDay(db, teacherId)) * SCHOOL_DAYS_PER_WEEK;
}

/**
 * Creates one schedule entry, guarded against a race between two
 * admins scheduling the same teacher at the same moment.
 *
 * pg_advisory_xact_lock(teacherId) serializes any two transactions
 * that both try to touch this teacher's schedule at once — the
 * second one simply waits until the first COMMITs or ROLLBACKs,
 * so the conflict SELECT that follows always sees the other
 * transaction's result. Without this lock, two concurrent requests
 * could both read "no conflict" before either one has written its
 * row, and both would be allowed to double-book the same teacher.
 * The lock is released automatically when the transaction ends.
 */
async function createScheduleEntry(input) {
  await assertSchoolYearEditable(input.schoolYearId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // No teacher yet (a freshly "+ Add Period"'d blank slot) means
    // nothing to serialize against — pg_advisory_xact_lock requires
    // a real bigint and would error on NULL.
    if (input.teacherId) await client.query('SELECT pg_advisory_xact_lock($1)', [input.teacherId]);

    if (input.roleType === 'subject' && input.subjectId) {
      const duplicateSubject = await findDuplicateSubjectInSection(client, {
        sectionId: input.sectionId, subjectId: input.subjectId, schoolYearId: input.schoolYearId, days: input.days,
      });
      if (duplicateSubject) {
        await client.query('ROLLBACK');
        return { duplicateSubject };
      }
    }

    if (input.roleType === 'subject' && input.teacherId) {
      const conflict = await findTeacherConflict(client, input);
      if (conflict) {
        await client.query('ROLLBACK');
        return { conflict };
      }
      const dailyCapExceeded = await checkDailyCap(client, input.teacherId, input.schoolYearId, input.days, null);
      if (dailyCapExceeded) {
        await client.query('ROLLBACK');
        return { dailyCapExceeded };
      }
      const load = await getTeacherWeeklyLoad(client, input.teacherId, input.schoolYearId, null);
      const weeklyCap = await getTeacherWeeklyCap(client, input.teacherId);
      if (load >= weeklyCap) {
        await client.query('ROLLBACK');
        return { overLoad: { current: load, cap: weeklyCap } };
      }
    }

    // A real assignment (has actual days) at a time slot that
    // already has an unclaimed blank placeholder — the row "+ Add
    // Period" created — reuses that same row instead of inserting a
    // second one and leaving the blank behind as an orphan nobody
    // can find again through the UI.
    const hasRealDays = input.days && input.days.length > 0;
    const reusableId = hasRealDays
      ? await findBlankPeriodEntry(input.sectionId, input.schoolYearId, input.session, input.startTime, input.endTime)
      : null;

    let entryId;
    if (reusableId) {
      await client.query(
        `UPDATE schedule_entries SET subject_id = $2, teacher_id = $3, days = $4, room = $5, updated_at = NOW()
         WHERE id = $1`,
        [reusableId, input.subjectId || null, input.teacherId || null, input.days, input.room || null]
      );
      entryId = reusableId;
    } else {
      const result = await client.query(
        `INSERT INTO schedule_entries
           (section_id, subject_id, teacher_id, session, days, start_time, end_time, room, role_type, school_year_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [input.sectionId, input.subjectId || null, input.teacherId || null, input.session || null, input.days || [],
          input.startTime || null, input.endTime || null, input.room || null, input.roleType,
          input.schoolYearId, input.createdBy]
      );
      entryId = result.rows[0].id;
    }
    await client.query('COMMIT');
    return { entry: { id: entryId } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateScheduleEntry(id, input) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT * FROM schedule_entries WHERE id = $1 FOR UPDATE', [id]);
    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      return { notFound: true };
    }
    const row = current.rows[0];
    await assertSchoolYearEditable(row.school_year_id);
    const teacherId = input.teacherId !== undefined ? input.teacherId : row.teacher_id;
    const subjectId = input.subjectId !== undefined ? input.subjectId : row.subject_id;
    const schoolYearId = row.school_year_id;
    const roleType = input.roleType !== undefined ? input.roleType : row.role_type;
    const sectionId = input.sectionId !== undefined ? input.sectionId : row.section_id;
    const days = input.days !== undefined ? input.days : row.days;
    const startTime = input.startTime !== undefined ? input.startTime : row.start_time;
    const endTime = input.endTime !== undefined ? input.endTime : row.end_time;

    if (teacherId) await client.query('SELECT pg_advisory_xact_lock($1)', [teacherId]);

    if (roleType === 'subject' && subjectId) {
      const duplicateSubject = await findDuplicateSubjectInSection(client, {
        sectionId, subjectId, schoolYearId, days, excludeEntryId: id,
      });
      if (duplicateSubject) {
        await client.query('ROLLBACK');
        return { duplicateSubject };
      }
    }

    if (roleType === 'subject' && teacherId) {
      const conflict = await findTeacherConflict(client, {
        teacherId, schoolYearId, days, startTime, endTime, excludeEntryId: id,
      });
      if (conflict) {
        await client.query('ROLLBACK');
        return { conflict };
      }
      const dailyCapExceeded = await checkDailyCap(client, teacherId, schoolYearId, days, id);
      if (dailyCapExceeded) {
        await client.query('ROLLBACK');
        return { dailyCapExceeded };
      }
      // Not previously checked here at all — only createScheduleEntry
      // enforced the weekly cap, so editing an existing entry (e.g.
      // reassigning it to a busier teacher) could silently push
      // someone over their weekly limit with no check at all.
      const load = await getTeacherWeeklyLoad(client, teacherId, schoolYearId, id);
      const weeklyCap = await getTeacherWeeklyCap(client, teacherId);
      if (load >= weeklyCap) {
        await client.query('ROLLBACK');
        return { overLoad: { current: load, cap: weeklyCap } };
      }
    }

    const sets = [];
    const params = [id];
    const fieldMap = {
      sectionId: 'section_id', subjectId: 'subject_id', teacherId: 'teacher_id',
      session: 'session', days: 'days', startTime: 'start_time', endTime: 'end_time',
      room: 'room', roleType: 'role_type',
    };
    for (const [key, col] of Object.entries(fieldMap)) {
      if (input[key] !== undefined) {
        params.push(input[key]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    sets.push('updated_at = NOW()');
    await client.query(`UPDATE schedule_entries SET ${sets.join(', ')} WHERE id = $1`, params);
    await client.query('COMMIT');
    return { entry: { id } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function deleteScheduleEntry(id) {
  const current = await pool.query('SELECT school_year_id FROM schedule_entries WHERE id = $1', [id]);
  if (current.rows.length === 0) return;
  await assertSchoolYearEditable(current.rows[0].school_year_id);
  await pool.query('DELETE FROM schedule_entries WHERE id = $1', [id]);
}

async function getTeacherAssignments(teacherId, schoolYearId) {
  const result = await pool.query(
    `SELECT se.id, se.role_type, se.session, se.days, se.start_time, se.end_time,
            sec.id AS section_id, sec.name AS section_name, gl.name AS grade_level_name,
            sub.id AS subject_id, sub.name AS subject_name
     FROM schedule_entries se
     JOIN sections sec ON sec.id = se.section_id
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     LEFT JOIN subjects sub ON sub.id = se.subject_id
     WHERE se.teacher_id = $1 AND se.school_year_id = $2
     ORDER BY se.start_time NULLS LAST`,
    [teacherId, schoolYearId]
  );
  return result.rows;
}

module.exports = {
  listGradeScheduleSummary, listSectionsForGrade, listSubjects, listAllSubjects,
  createSubject, deleteSubject, getSectionWeeklySchedule, findTeacherConflict, checkDailyCap,
  getTeacherWeeklyLoad, createScheduleEntry, updateScheduleEntry, deleteScheduleEntry,
  getTeacherAssignments,
};