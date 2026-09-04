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

module.exports = { linkStudentGuardian, createApplication, getMyApplications };