// One definition of "how many slots are left", used by every page and by the
// application endpoints, so the numbers can never disagree.
//
//   capacity   = "slots" typed for each section in School Settings
//   taken      = applications placed in that section that still hold a seat
//   left       = capacity - taken
//
// An application holds a seat from the moment it is submitted until it is
// rejected. Placing it in a section happens automatically (first section of
// the grade with a free seat), so the grade total is always the sum of its
// sections.
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
            ON ea.section_id = sec.id AND ea.status IN (${SEAT_LIST})
     WHERE sec.school_year_id = $1 AND ($2::int IS NULL OR sec.grade_level_id = $2)
     GROUP BY sec.id, gl.id
     ORDER BY gl.sort_order, sec.name`,
    [schoolYearId, gradeLevelId]
  );
  return rows.map((r) => ({ ...r, left: Math.max(0, r.capacity - r.taken) }));
}

// Seats per grade level: the sum of its sections, plus how many applications
// are still waiting for a section (only possible when every section was full
// or none existed when they applied).
async function gradeSeats(db, schoolYearId) {
  const { rows: grades } = await db.query('SELECT id, name, sort_order FROM grade_levels ORDER BY sort_order');
  const sections = await sectionSeats(db, schoolYearId);
  const { rows: waiting } = await db.query(
    `SELECT grade_level_id AS id, COUNT(*)::int AS n FROM enrollment_applications
     WHERE school_year_id = $1 AND section_id IS NULL AND status IN (${SEAT_LIST})
     GROUP BY grade_level_id`,
    [schoolYearId]
  );
  const waitingBy = Object.fromEntries(waiting.map((w) => [w.id, w.n]));
  return grades.map((g) => {
    const secs = sections.filter((s) => s.gradeLevelId === g.id);
    const capacity = secs.reduce((n, s) => n + s.capacity, 0);
    const taken = secs.reduce((n, s) => n + s.taken, 0);
    return {
      id: g.id, name: g.name, sortOrder: g.sort_order,
      sectionCount: secs.length, capacity, taken,
      left: Math.max(0, capacity - taken), waiting: waitingBy[g.id] || 0,
    };
  });
}

// Puts an application into the first section of its grade that has a free
// seat. Returns { sectionId } or { sectionId: null, reason }:
//   'no_sections' -> the school has not set up any section for this grade (no limit applies)
//   'full'        -> every section of the grade is full
// Must run inside the caller's transaction (client) so two parents cannot
// take the last seat at the same time: the section rows are locked first.
async function placeApplication(client, applicationId) {
  const { rows: [app] } = await client.query(
    'SELECT id, school_year_id, grade_level_id, section_id FROM enrollment_applications WHERE id = $1',
    [applicationId]
  );
  if (!app) return { sectionId: null, reason: 'missing' };
  if (app.section_id) return { sectionId: app.section_id };
  const placed = await placeInGrade(client, app.school_year_id, app.grade_level_id);
  if (placed.sectionId) {
    await client.query('UPDATE enrollment_applications SET section_id = $2 WHERE id = $1', [applicationId, placed.sectionId]);
  }
  return placed;
}

async function placeInGrade(client, schoolYearId, gradeLevelId) {
  const { rows: secs } = await client.query(
    `SELECT id, capacity FROM sections WHERE school_year_id = $1 AND grade_level_id = $2 ORDER BY name FOR UPDATE`,
    [schoolYearId, gradeLevelId]
  );
  if (!secs.length) return { sectionId: null, reason: 'no_sections' };
  for (const s of secs) {
    const { rows: [c] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM enrollment_applications WHERE section_id = $1 AND status IN (${SEAT_LIST})`,
      [s.id]
    );
    if (c.n < s.capacity) return { sectionId: s.id };
  }
  return { sectionId: null, reason: 'full' };
}

// Checks one chosen section (walk-in) has a free seat; locks it while checking.
async function sectionHasRoom(client, sectionId) {
  const { rows: [s] } = await client.query('SELECT id, capacity FROM sections WHERE id = $1 FOR UPDATE', [sectionId]);
  if (!s) return false;
  const { rows: [c] } = await client.query(
    `SELECT COUNT(*)::int AS n FROM enrollment_applications WHERE section_id = $1 AND status IN (${SEAT_LIST})`, [sectionId]
  );
  return c.n < s.capacity;
}

// One-off tidy-up at start-up: applications saved before sections were
// assigned automatically get a section now, oldest first, while seats last.
async function placeWaitingApplications(pool) {
  const { rows } = await pool.query(
    `SELECT id FROM enrollment_applications
     WHERE section_id IS NULL AND status IN (${SEAT_LIST}) ORDER BY submitted_at, id`
  );
  let placed = 0;
  for (const r of rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await placeApplication(client, r.id);
      await client.query('COMMIT');
      if (res.sectionId) placed++;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[seats] could not place application', r.id, err.message);
    } finally {
      client.release();
    }
  }
  return placed;
}

function fullMessage(gradeName) {
  return `There are no slots left for ${gradeName}. Please ask the school office about opening another section.`;
}

module.exports = {
  SEAT_STATUSES, SEAT_LIST, sectionSeats, gradeSeats, placeApplication, placeInGrade, sectionHasRoom,
  placeWaitingApplications, fullMessage,
};
