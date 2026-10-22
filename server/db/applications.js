const pool = require('./pool');

async function linkStudentGuardian(db, { studentId, guardianId, relationship }) {
  await db.query(
    `INSERT INTO student_guardians (student_id, guardian_id, relationship, is_primary)
     VALUES ($1, $2, $3, true)`,
    [studentId, guardianId, relationship]
  );
}

async function createApplication(db, { studentId, schoolYearId, gradeLevelId, submittedBy }) {
  const result = await db.query(
    `INSERT INTO enrollment_applications (student_id, school_year_id, grade_level_id, submitted_by)
     VALUES ($1, $2, $3, $4) RETURNING id, status, submitted_at`,
    [studentId, schoolYearId, gradeLevelId, submittedBy]
  );
  return result.rows[0];
}

async function getMyApplications(guardianId) {
  const result = await pool.query(
    `SELECT ea.id, s.first_name, s.last_name, gl.name AS grade_level,
            sy.label AS school_year, ea.status, ea.submitted_at, sec.name AS section
     FROM enrollment_applications ea
     JOIN students s ON s.id = ea.student_id
     JOIN student_guardians sg ON sg.student_id = s.id
     JOIN grade_levels gl ON gl.id = ea.grade_level_id
     JOIN school_years sy ON sy.id = ea.school_year_id
     LEFT JOIN sections sec ON sec.id = ea.section_id
     WHERE sg.guardian_id = $1
     ORDER BY ea.submitted_at DESC`,
    [guardianId]
  );
  return result.rows;
}

async function getApplicationForGuardian(applicationId, guardianId) {
  const result = await pool.query(
    `SELECT ea.id, s.id AS student_id, s.first_name, s.last_name, gl.name AS grade_level,
            sy.label AS school_year, ea.status, ea.submitted_at, ea.reviewed_at,
            ea.remarks, sec.name AS section, (s.lrn_hash IS NOT NULL) AS has_lrn
     FROM enrollment_applications ea
     JOIN students s ON s.id = ea.student_id
     JOIN student_guardians sg ON sg.student_id = s.id
     JOIN grade_levels gl ON gl.id = ea.grade_level_id
     JOIN school_years sy ON sy.id = ea.school_year_id
     LEFT JOIN sections sec ON sec.id = ea.section_id
     WHERE ea.id = $1 AND sg.guardian_id = $2`,
    [applicationId, guardianId]
  );
  return result.rows[0] || null;
}

/**
 * A child's weekly timetable, for the parent who owns the application.
 *
 * Shown only when all of these hold: the application belongs to this guardian,
 * it is approved, the learner has a section, and the registrar/admin has
 * published that section's timetable. Otherwise `state` says why not so the
 * page can explain it. Only finished periods are returned (subject + teacher
 * + days), never half-built rows.
 *
 * @returns {Promise<null|{state:'not_approved'|'no_section'|'not_published'|'published', ...}>}
 *          null when the application is not this guardian's.
 */
async function getScheduleForGuardian(applicationId, guardianId) {
  const { rows: [app] } = await pool.query(
    `SELECT ea.id, ea.status, ea.section_id, s.first_name, s.last_name,
            gl.name AS grade_level, sy.label AS school_year,
            sec.name AS section, sec.schedule_published_at,
            CASE WHEN t.id IS NULL THEN NULL ELSE t.first_name || ' ' || t.last_name END AS adviser
     FROM enrollment_applications ea
     JOIN students s ON s.id = ea.student_id
     JOIN student_guardians sg ON sg.student_id = s.id
     JOIN grade_levels gl ON gl.id = ea.grade_level_id
     JOIN school_years sy ON sy.id = ea.school_year_id
     LEFT JOIN sections sec ON sec.id = ea.section_id
     LEFT JOIN teachers t ON t.id = sec.adviser_teacher_id
     WHERE ea.id = $1 AND sg.guardian_id = $2`,
    [applicationId, guardianId]
  );
  if (!app) return null;

  const base = {
    applicationId: app.id, firstName: app.first_name, lastName: app.last_name,
    gradeLevel: app.grade_level, schoolYear: app.school_year, section: app.section, adviser: app.adviser,
  };
  if (app.status !== 'approved') return { ...base, state: 'not_approved', status: app.status };
  if (!app.section_id) return { ...base, state: 'no_section' };
  if (!app.schedule_published_at) return { ...base, state: 'not_published' };

  const { rows } = await pool.query(
    `SELECT se.session, se.days, se.start_time, se.end_time, se.room,
            sub.name AS subject_name,
            t.first_name AS teacher_first_name, t.last_name AS teacher_last_name
     FROM schedule_entries se
     JOIN subjects sub ON sub.id = se.subject_id
     JOIN teachers t ON t.id = se.teacher_id
     WHERE se.section_id = $1 AND se.school_year_id = (SELECT school_year_id FROM enrollment_applications WHERE id = $2)
       AND se.role_type = 'subject' AND COALESCE(array_length(se.days, 1), 0) > 0
     ORDER BY se.start_time, sub.name`,
    [app.section_id, applicationId]
  );
  return {
    ...base, state: 'published', publishedAt: app.schedule_published_at,
    entries: rows.map((r) => ({
      session: r.session, days: r.days,
      startTime: String(r.start_time).slice(0, 5), endTime: String(r.end_time).slice(0, 5),
      room: r.room, subject: r.subject_name,
      teacher: `${r.teacher_first_name} ${r.teacher_last_name}`,
    })),
  };
}

async function getActiveSchoolYear() {
  const result = await pool.query(
    `SELECT id, label FROM school_years WHERE is_active = true LIMIT 1`
  );
  return result.rows[0] || null;
}

module.exports = {
  linkStudentGuardian, createApplication, getMyApplications, getApplicationForGuardian, getScheduleForGuardian, getActiveSchoolYear,
};