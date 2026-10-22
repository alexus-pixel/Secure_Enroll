const pool = require('../pool');
const { isSchoolYearEditable } = require('./schoolSettings');
const { sessionTimeIssue } = require('../../validators/scheduleValidators');

// Times come back from Postgres as 'HH:MM:SS'; the rule (and the
// client) work in 'HH:MM'.
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

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

// The section list carries each section's adviser (sections.adviser_teacher_id,
// set from School Settings) so the schedule page can say whose section
// the timetable on screen belongs to without a second round trip, and
// without needing the school-settings endpoints the registrar cannot
// reach. adviser_teacher_id is nullable, so adviser_name comes back
// null for a section that has no adviser yet.
async function listSectionsForGrade(gradeLevelId, schoolYearId) {
  const result = await pool.query(
    `SELECT sec.id, sec.name, sec.adviser_teacher_id, sec.schedule_published_at,
            t.first_name AS adviser_first_name,
            t.last_name  AS adviser_last_name,
            t.middle_name AS adviser_middle_name,
            CASE WHEN t.id IS NULL THEN NULL
                 ELSE t.first_name || ' ' || t.last_name END AS adviser_name
     FROM sections sec
     LEFT JOIN teachers t ON t.id = sec.adviser_teacher_id
     WHERE sec.grade_level_id = $1 AND sec.school_year_id = $2
     ORDER BY sec.name`,
    [gradeLevelId, schoolYearId]
  );
  return result.rows;
}

// One section's adviser on its own, for the schedule being viewed.
async function getSectionAdviser(sectionId, schoolYearId) {
  const result = await pool.query(
    `SELECT sec.id, sec.name, sec.adviser_teacher_id,
            gl.id AS grade_level_id, gl.name AS grade_level_name,
            t.first_name AS adviser_first_name,
            t.last_name  AS adviser_last_name,
            CASE WHEN t.id IS NULL THEN NULL
                 ELSE t.first_name || ' ' || t.last_name END AS adviser_name
     FROM sections sec
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     LEFT JOIN teachers t ON t.id = sec.adviser_teacher_id
     WHERE sec.id = $1 AND sec.school_year_id = $2`,
    [sectionId, schoolYearId]
  );
  const row = result.rows[0];
  if (!row) return { notFound: true };
  return {
    sectionId: row.id,
    sectionName: row.name,
    gradeLevelId: row.grade_level_id,
    gradeLevelName: row.grade_level_name,
    adviserTeacherId: row.adviser_teacher_id || null,
    adviserName: row.adviser_name,
    adviserFirstName: row.adviser_first_name,
    adviserLastName: row.adviser_last_name,
  };
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

// Each grade level carries its own ceiling on how many subjects it
// may have (grade_levels.max_subjects, 1-20, default 10) — a Grade 1
// pupil does not sit the same number of subjects as a Grade 6 one,
// so the admin sets the number per grade rather than school-wide.
//
// Two admins adding the last allowed subject at the same moment
// would both read "9 of 10" and both insert, so the count and the
// insert happen inside one transaction behind an advisory lock on
// the grade level. The same lock guards lowering the limit, which
// is the mirror-image race (one admin adds a subject while another
// drops the ceiling to the count they just read).
const SUBJECT_LOCK_NAMESPACE = 21826;

function ruleError(message, status, reason, details) {
  const err = new Error(message);
  err.status = status;
  err.reason = reason;
  err.details = details;
  return err;
}

async function getGradeLevel(gradeLevelId) {
  const result = await pool.query(
    'SELECT id, name, max_subjects FROM grade_levels WHERE id = $1',
    [gradeLevelId]
  );
  return result.rows[0] || null;
}

async function countSubjects(db, gradeLevelId, schoolYearId) {
  const result = await db.query(
    'SELECT COUNT(*)::int AS count FROM subjects WHERE grade_level_id = $1 AND school_year_id = $2',
    [gradeLevelId, schoolYearId]
  );
  return result.rows[0].count;
}

// The panel on the grade's schedule page needs more than the names:
// how many periods each subject fills (removal is refused while that
// is above zero) and how many teachers are linked to it (removal is
// allowed, but the confirmation has to say what gets unlinked).
async function listSubjectsWithUsage(gradeLevelId, schoolYearId) {
  const result = await pool.query(
    `SELECT s.id, s.name, s.is_domain,
            (SELECT COUNT(*)::int FROM schedule_entries se WHERE se.subject_id = s.id) AS scheduled_count,
            (SELECT COUNT(*)::int FROM teacher_subjects ts WHERE ts.subject_id = s.id) AS teacher_count
     FROM subjects s
     WHERE s.grade_level_id = $1 AND s.school_year_id = $2
     ORDER BY s.is_domain DESC, s.name`,
    [gradeLevelId, schoolYearId]
  );
  return result.rows;
}

// Everything the subject panel shows in one reply: the grade, its
// limit, the live count behind the "7 of 10 subjects" counter, and
// the subjects themselves.
async function getSubjectSettings(gradeLevelId, schoolYearId) {
  const grade = await getGradeLevel(gradeLevelId);
  if (!grade) return { notFound: true };
  const subjects = await listSubjectsWithUsage(gradeLevelId, schoolYearId);
  return {
    gradeLevelId: grade.id,
    gradeLevelName: grade.name,
    maxSubjects: grade.max_subjects,
    count: subjects.length,
    subjects,
  };
}

async function createSubject({ name, gradeLevelId, schoolYearId, isDomain }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [SUBJECT_LOCK_NAMESPACE, gradeLevelId]);
    const graded = await client.query('SELECT id, name, max_subjects FROM grade_levels WHERE id = $1', [gradeLevelId]);
    if (graded.rows.length === 0) {
      throw ruleError('That grade level does not exist.', 404, 'grade_level_not_found');
    }
    const grade = graded.rows[0];
    const count = await countSubjects(client, gradeLevelId, schoolYearId);
    if (count >= grade.max_subjects) {
      throw ruleError(
        `${grade.name} is already at its limit of ${grade.max_subjects} subjects. `
          + `Raise the limit for ${grade.name} or remove a subject first.`,
        409,
        'subject_limit_reached',
        { gradeLevelId: grade.id, gradeLevelName: grade.name, limit: grade.max_subjects, count }
      );
    }
    const result = await client.query(
      `INSERT INTO subjects (name, grade_level_id, school_year_id, is_domain)
       VALUES ($1, $2, $3, $4) RETURNING id, name, is_domain`,
      [name, gradeLevelId, schoolYearId, isDomain]
    );
    await client.query('COMMIT');
    return { subject: { ...result.rows[0], scheduled_count: 0, teacher_count: 0 }, count: count + 1, maxSubjects: grade.max_subjects };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* the transaction is already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

// Renaming is deliberately allowed even while the subject is on the
// timetable: schedule_entries points at the subject's id, not its
// name, so "Math" becoming "Mathematics" updates every period that
// shows it rather than orphaning anything. Only REMOVAL is blocked
// while the subject is scheduled (see deleteSubject).
async function updateSubject(id, { name, isDomain }) {
  const existing = await pool.query(
    'SELECT id, name, is_domain, grade_level_id, school_year_id FROM subjects WHERE id = $1',
    [id]
  );
  if (existing.rows.length === 0) return { notFound: true };
  const before = existing.rows[0];
  const nextName = name !== undefined ? name : before.name;
  const nextIsDomain = isDomain !== undefined ? isDomain : before.is_domain;
  const result = await pool.query(
    'UPDATE subjects SET name = $2, is_domain = $3 WHERE id = $1 RETURNING id, name, is_domain',
    [id, nextName, nextIsDomain]
  );
  const usage = await pool.query(
    `SELECT (SELECT COUNT(*)::int FROM schedule_entries se WHERE se.subject_id = $1) AS scheduled_count,
            (SELECT COUNT(*)::int FROM teacher_subjects ts WHERE ts.subject_id = $1) AS teacher_count`,
    [id]
  );
  return { before, subject: { ...result.rows[0], ...usage.rows[0] } };
}

async function deleteSubject(id) {
  const existing = await pool.query(
    'SELECT id, name, grade_level_id, school_year_id FROM subjects WHERE id = $1',
    [id]
  );
  if (existing.rows.length === 0) return { notFound: true };
  const subject = existing.rows[0];

  // Removing a subject that is actively scheduled would silently
  // orphan those schedule_entries rows (subject_id has no ON DELETE
  // rule of its own beyond the FK, so this would fail loudly
  // instead — which is what we want: force the admin to remove the
  // schedule entries first, not lose the record of what a class
  // was actually being taught).
  const inUse = await pool.query(
    'SELECT COUNT(*)::int AS count FROM schedule_entries WHERE subject_id = $1',
    [id]
  );
  if (inUse.rows[0].count > 0) {
    throw ruleError(
      `${subject.name} is still used in ${inUse.rows[0].count} scheduled period`
        + `${inUse.rows[0].count === 1 ? '' : 's'}. Remove those periods first.`,
      409,
      'subject_in_schedule',
      { scheduledCount: inUse.rows[0].count }
    );
  }

  // A subject only linked to teachers (teacher_subjects, ON DELETE
  // CASCADE) may go — nothing on the timetable depends on it — but
  // the caller is told how many links disappear so the confirmation
  // can say so out loud instead of quietly dropping them.
  const links = await pool.query(
    'SELECT COUNT(*)::int AS count FROM teacher_subjects WHERE subject_id = $1',
    [id]
  );
  await pool.query('DELETE FROM subjects WHERE id = $1', [id]);
  return { subject, teacherLinksRemoved: links.rows[0].count };
}

// Lowering the ceiling under what the grade already has would leave
// it permanently over its own limit, so that is refused and the
// admin is told how many subjects stand in the way.
async function setMaxSubjects(gradeLevelId, maxSubjects, schoolYearId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [SUBJECT_LOCK_NAMESPACE, gradeLevelId]);
    const graded = await client.query(
      'SELECT id, name, max_subjects FROM grade_levels WHERE id = $1 FOR UPDATE',
      [gradeLevelId]
    );
    if (graded.rows.length === 0) {
      await client.query('ROLLBACK');
      return { notFound: true };
    }
    const grade = graded.rows[0];
    const count = await countSubjects(client, gradeLevelId, schoolYearId);
    if (maxSubjects < count) {
      const over = count - maxSubjects;
      throw ruleError(
        `${grade.name} already has ${count} subjects, so the limit cannot be lowered to ${maxSubjects}. `
          + `Remove ${over} subject${over === 1 ? '' : 's'} first.`,
        409,
        'limit_below_current',
        { gradeLevelId: grade.id, gradeLevelName: grade.name, count, requestedLimit: maxSubjects }
      );
    }
    await client.query('UPDATE grade_levels SET max_subjects = $2 WHERE id = $1', [gradeLevelId, maxSubjects]);
    await client.query('COMMIT');
    return {
      gradeLevelId: grade.id,
      gradeLevelName: grade.name,
      previousMax: grade.max_subjects,
      maxSubjects,
      count,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* the transaction is already gone */ }
    throw err;
  } finally {
    client.release();
  }
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
 * Publish (or take down) one section's timetable for parents.
 *
 * A parent sees a child's schedule only while the child's section is
 * published. An empty timetable cannot be published: "assigned" means a period
 * that has a subject, a teacher and at least one day, which is what a parent's
 * timetable actually shows.
 *
 * @returns {Promise<{notFound:true}|{nothingToPublish:true}|object>}
 */
async function setSectionSchedulePublished(sectionId, schoolYearId, userId, publish) {
  const { rows: [sec] } = await pool.query(
    `SELECT sec.id, sec.name, gl.name AS grade_level_name,
            (SELECT COUNT(*) FROM schedule_entries se
              WHERE se.section_id = sec.id AND se.school_year_id = sec.school_year_id
                AND se.role_type = 'subject' AND se.subject_id IS NOT NULL
                AND se.teacher_id IS NOT NULL AND COALESCE(array_length(se.days, 1), 0) > 0)::int AS assigned
     FROM sections sec JOIN grade_levels gl ON gl.id = sec.grade_level_id
     WHERE sec.id = $1 AND sec.school_year_id = $2`,
    [sectionId, schoolYearId]
  );
  if (!sec) return { notFound: true };
  if (publish && sec.assigned === 0) return { nothingToPublish: true, sectionName: sec.name, gradeLevelName: sec.grade_level_name };

  const { rows: [row] } = await pool.query(
    `UPDATE sections
        SET schedule_published_at = CASE WHEN $3 THEN now() ELSE NULL END,
            schedule_published_by = CASE WHEN $3 THEN $4::bigint ELSE NULL END
      WHERE id = $1 AND school_year_id = $2
      RETURNING schedule_published_at`,
    [sectionId, schoolYearId, publish, userId]
  );
  return {
    sectionId: sec.id, sectionName: sec.name, gradeLevelName: sec.grade_level_name,
    published: Boolean(row.schedule_published_at), publishedAt: row.schedule_published_at,
    periods: sec.assigned,
  };
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
 * Is this room already in use during any part of this period?
 *
 * A room holds one class at a time, so a room taken at 7:00-8:00 on Monday is
 * not available to any other section (in any grade) for a period that touches
 * those hours on that day. Two periods that merely meet (one ends at 8:00, the
 * next starts at 8:00) do not clash. Room names are compared ignoring case and
 * surrounding spaces, so "Rm 101" and "rm 101 " are the same room.
 *
 * A period with no room, or no days yet (the blank "+ Add Period" slot), has
 * nothing to clash with.
 */
async function findRoomConflict(db, { room, schoolYearId, days, startTime, endTime, excludeEntryId }) {
  const name = String(room || '').trim();
  if (!name || !days || days.length === 0 || !startTime || !endTime) return null;
  const result = await db.query(
    `SELECT se.id, se.room, se.days, se.start_time, se.end_time,
            sec.name AS section_name, gl.name AS grade_level_name, sub.name AS subject_name
       FROM schedule_entries se
       JOIN sections sec ON sec.id = se.section_id
       JOIN grade_levels gl ON gl.id = sec.grade_level_id
       LEFT JOIN subjects sub ON sub.id = se.subject_id
      WHERE se.school_year_id = $2
        AND se.role_type = 'subject'
        AND se.room IS NOT NULL
        AND LOWER(BTRIM(se.room)) = LOWER($1)
        AND se.days && $3::smallint[]
        AND se.start_time < $5::time
        AND se.end_time > $4::time
        AND ($6::bigint IS NULL OR se.id <> $6)
      ORDER BY se.start_time
      LIMIT 1`,
    [name, schoolYearId, days, startTime, endTime, excludeEntryId || null]
  );
  return result.rows[0] || null;
}

/**
 * A teacher can only be given a subject they are assigned to teach. The link is
 * made on the teacher's own record (teacher_subjects), so the schedule never
 * puts someone in front of a class they are not set up for.
 */
async function findTeacherSubjectMismatch(db, { teacherId, subjectId }) {
  if (!teacherId || !subjectId) return null;
  const { rows: [link] } = await db.query(
    'SELECT 1 FROM teacher_subjects WHERE teacher_id = $1 AND subject_id = $2', [teacherId, subjectId]
  );
  if (link) return null;
  const { rows: [info] } = await db.query(
    `SELECT t.first_name, t.last_name, s.name AS subject_name
       FROM teachers t, subjects s WHERE t.id = $1 AND s.id = $2`,
    [teacherId, subjectId]
  );
  return info || { first_name: '', last_name: '', subject_name: '' };
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

/**
 * Does this period run across one the section already has?
 *
 * The teacher clash above asks whether one person can be in two places at
 * once. This asks the other question: a class is one group of children, so
 * its own timetable cannot run 7:00-8:00 and 7:30-8:30 at the same time
 * either, whoever is teaching them. A new period has to start where the last
 * one ended.
 *
 * The overlap test is the standard one — new starts before the other ends
 * AND new ends after the other starts — so two periods that merely touch
 * (8:00 after a 7:00-8:00) are fine.
 *
 * Two things are deliberately NOT treated as overlaps:
 *
 *   - the exact same time range, because that IS this period. The grade
 *     schedule page shows one row per time range and a separate entry per
 *     day inside it, so filling Tuesday on a 7:00-8:00 row means writing a
 *     second 7:00-8:00 entry next to Monday's.
 *   - nothing, when the days do not meet — except that a period with no
 *     days yet (the blank "+ Add Period" placeholder) stands for the whole
 *     week on either side of the comparison, since that is the section's
 *     period slot rather than one day's lesson.
 */
async function findSectionPeriodOverlap(db, { sectionId, schoolYearId, days, startTime, endTime, excludeEntryId }) {
  if (!sectionId || !startTime || !endTime) return null;
  const result = await db.query(
    `SELECT se.id, se.days, se.start_time, se.end_time,
            sub.name AS subject_name,
            t.first_name AS teacher_first_name, t.last_name AS teacher_last_name
     FROM schedule_entries se
     LEFT JOIN subjects sub ON sub.id = se.subject_id
     LEFT JOIN teachers t ON t.id = se.teacher_id
     WHERE se.section_id = $1
       AND se.school_year_id = $2
       AND se.role_type = 'subject'
       AND se.start_time IS NOT NULL AND se.end_time IS NOT NULL
       AND se.start_time < $4::time
       AND se.end_time > $3::time
       AND NOT (se.start_time = $3::time AND se.end_time = $4::time)
       AND (se.days && $5::smallint[] OR se.days = '{}' OR cardinality($5::smallint[]) = 0)
       AND ($6::bigint IS NULL OR se.id <> $6)
     ORDER BY se.start_time
     LIMIT 1`,
    [sectionId, schoolYearId, startTime, endTime, days || [], excludeEntryId || null]
  );
  return result.rows[0] || null;
}

/**
 * Can this teacher be put on a class at all?
 *
 * A teacher who has been deactivated or retired keeps the classes they already
 * had until somebody hands them over, but takes no new ones: the picker leaves
 * them out, and this is the rule behind it, for anything that calls the API
 * directly.
 */
/**
 * A period is filed under one school year, so the section it sits in has to
 * belong to that year. Without this, a section id from last year would quietly
 * attach this year's period to last year's class.
 */
async function assertSectionInYear(db, sectionId, schoolYearId) {
  if (!sectionId || !schoolYearId) return;
  const { rows: [row] } = await db.query(
    'SELECT id FROM sections WHERE id = $1 AND school_year_id = $2', [sectionId, schoolYearId]
  );
  if (!row) {
    throw Object.assign(
      new Error('That section does not belong to this school year.'),
      { status: 400, reason: 'section_wrong_year' }
    );
  }
}

async function assertTeacherAssignable(db, teacherId) {
  if (!teacherId) return;
  const { rows: [t] } = await db.query(
    'SELECT first_name, last_name, is_active, status FROM teachers WHERE id = $1', [teacherId]
  );
  if (!t) {
    throw Object.assign(new Error('That teacher was not found.'), { status: 404 });
  }
  if (!t.is_active || t.status !== 'active') {
    throw Object.assign(
      new Error(`${t.last_name}, ${t.first_name} is not an active teacher and cannot be given a class. Reactivate them first.`),
      { status: 409, reason: 'teacher_inactive' }
    );
  }
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
  return result.rows[0]?.max_periods_per_day ?? 10;
}

// Each teacher has their own editable daily cap (teachers.max_periods_per_day,
// default 5). A booking can span several days at once, so every day
// it touches gets checked; the first day that would be pushed over
// its cap is returned (with enough context for a clear message),
// not just a bare yes/no.
/**
 * How many period slots the school actually runs on one day: the distinct
 * start-and-end times anything is timetabled at. Nobody can teach more periods
 * in a day than there are slots to teach them in, whatever their own limit
 * says, because two of them would have to be at the same hour.
 */
async function getDailySlotCount(db, schoolYearId, day) {
  const { rows: [row] } = await db.query(
    `SELECT COUNT(DISTINCT (start_time, end_time))::int AS slots
       FROM schedule_entries
      WHERE school_year_id = $1 AND role_type = 'subject'
        AND $2 = ANY(days) AND start_time IS NOT NULL AND end_time IS NOT NULL`,
    [schoolYearId, day]
  );
  return row?.slots || 0;
}

async function checkDailyCap(db, teacherId, schoolYearId, days, excludeEntryId) {
  const cap = await getTeacherMaxPeriodsPerDay(db, teacherId);
  for (const day of days) {
    const current = await getTeacherDailyLoad(db, teacherId, schoolYearId, day, excludeEntryId);
    // The day's own ceiling binds as well as the teacher's: a teacher allowed
    // 8 periods still cannot take a 4th on a day that only runs 3.
    const slots = await getDailySlotCount(db, schoolYearId, day);
    const effective = slots > 0 ? Math.min(cap, slots) : cap;
    if (current + 1 > effective) {
      return { day, current, cap: effective, teacherCap: cap, daySlots: slots };
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
  // The session/time rule, re-checked here rather than only in the
  // request schema: this is the last gate before the row is written,
  // so every caller (including a future one) gets the same answer.
  if (input.roleType !== 'adviser') {
    const mismatch = sessionTimeIssue(input.session, input.startTime, input.endTime);
    if (mismatch) {
      return {
        sessionMismatch: {
          ...mismatch,
          session: input.session,
          startTime: hhmm(input.startTime),
          endTime: hhmm(input.endTime),
        },
      };
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // No teacher yet (a freshly "+ Add Period"'d blank slot) means
    // nothing to serialize against — pg_advisory_xact_lock requires
    // a real bigint and would error on NULL.
    if (input.teacherId) await client.query('SELECT pg_advisory_xact_lock($1)', [input.teacherId]);

    // The section's own timetable comes first, because it applies to a blank
    // "+ Add Period" slot as much as to a filled one: an overlapping period
    // should be refused when it is created, not when somebody later tries to
    // put a subject in it.
    if (input.roleType === 'subject') {
      const sectionOverlap = await findSectionPeriodOverlap(client, {
        sectionId: input.sectionId, schoolYearId: input.schoolYearId, days: input.days,
        startTime: input.startTime, endTime: input.endTime,
      });
      if (sectionOverlap) {
        await client.query('ROLLBACK');
        return { sectionOverlap };
      }
    }

    if (input.roleType === 'subject' && input.subjectId) {
      const duplicateSubject = await findDuplicateSubjectInSection(client, {
        sectionId: input.sectionId, subjectId: input.subjectId, schoolYearId: input.schoolYearId, days: input.days,
      });
      if (duplicateSubject) {
        await client.query('ROLLBACK');
        return { duplicateSubject };
      }
    }

    await assertTeacherAssignable(client, input.teacherId);
    await assertSectionInYear(client, input.sectionId, input.schoolYearId);

    if (input.roleType === 'subject' && input.teacherId && input.subjectId) {
      const teacherSubjectMismatch = await findTeacherSubjectMismatch(client, input);
      if (teacherSubjectMismatch) {
        await client.query('ROLLBACK');
        return { teacherSubjectMismatch };
      }
    }

    if (input.roleType === 'subject' && input.room) {
      const roomConflict = await findRoomConflict(client, {
        room: input.room, schoolYearId: input.schoolYearId, days: input.days,
        startTime: input.startTime, endTime: input.endTime,
      });
      if (roomConflict) {
        await client.query('ROLLBACK');
        return { roomConflict };
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
    const startTime = hhmm(input.startTime !== undefined ? input.startTime : row.start_time);
    const endTime = hhmm(input.endTime !== undefined ? input.endTime : row.end_time);
    const session = input.session !== undefined ? input.session : row.session;

    // Changing only the session (or only one of the times) can still
    // land the period in the wrong half of the day, so the rule is
    // applied to the row as it WOULD stand after this update, not
    // just to the fields that happen to have been sent.
    if (roleType !== 'adviser') {
      const mismatch = sessionTimeIssue(session, startTime, endTime);
      if (mismatch) {
        await client.query('ROLLBACK');
        return { sessionMismatch: { ...mismatch, session, startTime, endTime } };
      }
      if (startTime && endTime && startTime >= endTime) {
        await client.query('ROLLBACK');
        return {
          sessionMismatch: {
            field: 'endTime', message: 'End time must be after start time.',
            session, startTime, endTime,
          },
        };
      }
    }

    if (teacherId) await client.query('SELECT pg_advisory_xact_lock($1)', [teacherId]);

    // Moving a period onto somebody is giving them a class, so the same rule
    // applies — unless the teacher on the row is not changing, which would
    // otherwise make an inactive teacher's existing period impossible to edit
    // or hand over.
    if (input.teacherId !== undefined && input.teacherId !== row.teacher_id) {
      await assertTeacherAssignable(client, input.teacherId);
    }
    if (input.sectionId !== undefined && String(input.sectionId) !== String(row.section_id)) {
      await assertSectionInYear(client, input.sectionId, schoolYearId);
    }

    // Judged against the row as it will stand after the change, like the
    // session/time rule above — an edit that moves a period onto another
    // one is the same mistake as creating it there.
    if (roleType === 'subject') {
      const sectionOverlap = await findSectionPeriodOverlap(client, {
        sectionId, schoolYearId, days, startTime, endTime, excludeEntryId: id,
      });
      if (sectionOverlap) {
        await client.query('ROLLBACK');
        return { sectionOverlap };
      }
    }

    if (roleType === 'subject' && subjectId) {
      const duplicateSubject = await findDuplicateSubjectInSection(client, {
        sectionId, subjectId, schoolYearId, days, excludeEntryId: id,
      });
      if (duplicateSubject) {
        await client.query('ROLLBACK');
        return { duplicateSubject };
      }
    }

    // The teacher has to be assigned to the subject. Judged on the row as it
    // will stand, but only when the teacher or the subject is what changed, so
    // moving an older period's time is never blocked by a link made later.
    if (roleType === 'subject' && teacherId && subjectId
      && (input.teacherId !== undefined || input.subjectId !== undefined)) {
      const teacherSubjectMismatch = await findTeacherSubjectMismatch(client, { teacherId, subjectId });
      if (teacherSubjectMismatch) {
        await client.query('ROLLBACK');
        return { teacherSubjectMismatch };
      }
    }

    // A room holds one class at a time.
    const room = input.room !== undefined ? input.room : row.room;
    if (roleType === 'subject' && room) {
      const roomConflict = await findRoomConflict(client, {
        room, schoolYearId, days, startTime, endTime, excludeEntryId: id,
      });
      if (roomConflict) {
        await client.query('ROLLBACK');
        return { roomConflict };
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
  listSubjectsWithUsage, getSubjectSettings, getGradeLevel, setMaxSubjects, getSectionAdviser,
  createSubject, updateSubject, deleteSubject, getSectionWeeklySchedule, setSectionSchedulePublished, findTeacherConflict,
  findSectionPeriodOverlap, findRoomConflict, findTeacherSubjectMismatch, checkDailyCap,
  getTeacherWeeklyLoad, createScheduleEntry, updateScheduleEntry, deleteScheduleEntry,
  getTeacherAssignments, assertTeacherAssignable,
};