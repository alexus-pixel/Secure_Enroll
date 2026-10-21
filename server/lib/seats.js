// One definition of "how many slots are left", used by every page and by the
// application endpoints, so the numbers can never disagree.
//
//   capacity per grade   = the "slots" typed for each of its sections in School Settings
//   taken per grade      = applications that hold a seat (submitted up to approved,
//                          not rejected), whether or not a section is chosen yet
//   left per grade       = capacity - taken
//
// A section is only chosen AFTER an application is approved: the registrar or
// admin picks one of the grade's sections that still has room, and that is the
// section the learner is enrolled in (and the section's master list).
//   enrolled per section = approved applications placed in that section
//   left per section     = section capacity - enrolled
//
// When every grade level has sections and every grade is full, enrollment
// closes by itself (see enrollmentIsFull and utils/enrollmentStatus.js).
const SEAT_STATUSES = ['submitted', 'under_review', 'resubmitted', 'needs_revision', 'approved'];
const SEAT_LIST = SEAT_STATUSES.map((s) => `'${s}'`).join(',');

// Seats per section for one school year (optionally one grade level).
async function sectionSeats(db, schoolYearId, gradeLevelId = null) {
  const { rows } = await db.query(
    `SELECT sec.id, sec.name, sec.capacity, sec.grade_level_id AS "gradeLevelId", gl.name AS "gradeLevelName",
            COUNT(ea.id)::int AS taken
     FROM sections sec
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     LEFT JOIN enrollment_applications ea
            ON ea.section_id = sec.id AND ea.status = 'approved'
     WHERE sec.school_year_id = $1 AND ($2::int IS NULL OR sec.grade_level_id = $2)
     GROUP BY sec.id, gl.id
     ORDER BY gl.sort_order, sec.name`,
    [schoolYearId, gradeLevelId]
  );
  return rows.map((r) => ({ ...r, left: Math.max(0, r.capacity - r.taken) }));
}

// Seats per grade level. `waiting` = approved applications that still have no
// section (older data, or approved before the grade had any section).
async function gradeSeats(db, schoolYearId) {
  const { rows: grades } = await db.query('SELECT id, name, sort_order FROM grade_levels ORDER BY sort_order');
  const { rows: secs } = await db.query(
    `SELECT grade_level_id AS id, COUNT(*)::int AS sections, COALESCE(SUM(capacity), 0)::int AS capacity
     FROM sections WHERE school_year_id = $1 GROUP BY grade_level_id`,
    [schoolYearId]
  );
  const { rows: held } = await db.query(
    `SELECT grade_level_id AS id, COUNT(*)::int AS taken,
            COUNT(*) FILTER (WHERE status = 'approved' AND section_id IS NOT NULL)::int AS enrolled,
            COUNT(*) FILTER (WHERE status = 'approved' AND section_id IS NULL)::int AS waiting
     FROM enrollment_applications
     WHERE school_year_id = $1 AND status IN (${SEAT_LIST})
     GROUP BY grade_level_id`,
    [schoolYearId]
  );
  const secBy = Object.fromEntries(secs.map((r) => [r.id, r]));
  const heldBy = Object.fromEntries(held.map((r) => [r.id, r]));
  return grades.map((g) => {
    const s = secBy[g.id] || { sections: 0, capacity: 0 };
    const h = heldBy[g.id] || { taken: 0, enrolled: 0, waiting: 0 };
    return {
      id: g.id, name: g.name, sortOrder: g.sort_order,
      sectionCount: s.sections, capacity: s.capacity, taken: h.taken,
      left: Math.max(0, s.capacity - h.taken), enrolled: h.enrolled, waiting: h.waiting,
    };
  });
}

// True when every grade level has sections set up and every grade is full.
// A grade without sections has no limit, so enrollment cannot be "full" while
// one exists.
function seatsAreFull(grades) {
  return grades.length > 0 && grades.every((g) => g.sectionCount > 0 && g.left === 0);
}
async function enrollmentIsFull(db, schoolYearId) {
  return seatsAreFull(await gradeSeats(db, schoolYearId));
}

// Is there a seat left in this grade for one more application? Locks the
// grade's sections while checking (call it inside the caller's transaction) so
// two parents cannot take the last seat at the same time. A grade with no
// sections set up has no limit.
async function gradeHasRoom(client, schoolYearId, gradeLevelId, exceptApplicationId = null) {
  const { rows: secs } = await client.query(
    'SELECT id, capacity FROM sections WHERE school_year_id = $1 AND grade_level_id = $2 ORDER BY id FOR UPDATE',
    [schoolYearId, gradeLevelId]
  );
  if (!secs.length) return true;
  const capacity = secs.reduce((n, s) => n + s.capacity, 0);
  const { rows: [c] } = await client.query(
    `SELECT COUNT(*)::int AS n FROM enrollment_applications
     WHERE school_year_id = $1 AND grade_level_id = $2 AND status IN (${SEAT_LIST})
       AND ($3::bigint IS NULL OR id <> $3)`,
    [schoolYearId, gradeLevelId, exceptApplicationId]
  );
  return c.n < capacity;
}

// Enrols an approved (or about-to-be-approved) application in the chosen
// section. Returns { ok: true } or { ok: false, status, message }.
async function assignSection(client, applicationId, sectionId) {
  const { rows: [app] } = await client.query(
    'SELECT id, school_year_id, grade_level_id FROM enrollment_applications WHERE id = $1', [applicationId]
  );
  if (!app) return { ok: false, status: 404, message: 'Application not found.' };
  const { rows: [sec] } = await client.query(
    'SELECT id, name, capacity FROM sections WHERE id = $1 AND grade_level_id = $2 AND school_year_id = $3 FOR UPDATE',
    [sectionId, app.grade_level_id, app.school_year_id]
  );
  if (!sec) return { ok: false, status: 400, message: 'Choose one of the sections listed for this grade level.' };
  const { rows: [c] } = await client.query(
    `SELECT COUNT(*)::int AS n FROM enrollment_applications
     WHERE section_id = $1 AND status = 'approved' AND id <> $2`, [sec.id, app.id]
  );
  if (c.n >= sec.capacity) return { ok: false, status: 409, message: `${sec.name} has no slots left. Choose another section.` };
  await client.query('UPDATE enrollment_applications SET section_id = $2 WHERE id = $1', [app.id, sec.id]);
  return { ok: true, sectionName: sec.name };
}

// The sections an approval can choose from: the grade's sections, with room left.
async function sectionsForApplication(db, applicationId) {
  const { rows: [app] } = await db.query(
    'SELECT school_year_id, grade_level_id, section_id FROM enrollment_applications WHERE id = $1', [applicationId]
  );
  if (!app) return null;
  const list = await sectionSeats(db, app.school_year_id, app.grade_level_id);
  return {
    assignedSectionId: app.section_id,
    sections: list.map((s) => ({ id: s.id, name: s.name, capacity: s.capacity, enrolled: s.taken, slotsLeft: s.left })),
  };
}

function fullMessage(gradeName) {
  return `There are no slots left for ${gradeName}. Please ask the school office about opening another section.`;
}

module.exports = {
  SEAT_STATUSES, SEAT_LIST, sectionSeats, gradeSeats, seatsAreFull, enrollmentIsFull,
  gradeHasRoom, assignSection, sectionsForApplication, fullMessage,
};
