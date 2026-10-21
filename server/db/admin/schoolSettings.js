const pool = require('../pool');
const { SEAT_LIST, sectionSeats } = require('../../lib/seats');
const { schoolYearLabelFor } = require('../../validators/settingsValidators');

// Whether a school year has already begun is judged against today in
// Philippine time, the same clock the enrollment window is judged by. A year
// that starts on 1 June has not begun while it is still 31 May in Manila,
// whatever the server's own time zone happens to be.
const MANILA_TODAY = "(NOW() AT TIME ZONE 'Asia/Manila')::date";
const HAS_STARTED = `((opens_at AT TIME ZONE 'Asia/Manila')::date <= ${MANILA_TODAY})`;

// A Y-M-D date as it would be written in a letter to a parent, for the
// sentences the administrator reads when a change is refused.
// Today, as the school in Caloocan would write it.
const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

const spellDate = (ymd) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date(`${ymd}T00:00:00Z`));

async function listSchoolYears() {
  const result = await pool.query(
    `SELECT id, label, opens_at, closes_at, classes_start_on::text AS classes_start_on,
            is_active, enrollment_open, dates_confirmed,
            (closes_at <= CURRENT_DATE) AS is_ended,
            ${HAS_STARTED} AS has_started
     FROM school_years ORDER BY opens_at DESC`
  );
  return result.rows;
}

// Pure integer arithmetic on the Y-M-D parts — deliberately never
// goes through `new Date(dateString)` + getMonth()/setMonth(),
// since those read and write in the server process's *local*
// timezone. A date-only string like "2030-06-01" parses as UTC
// midnight, so on a server running anywhere west of UTC that would
// silently read back as May, not June, before any month is even
// added — a one-day, once-a-year bug that would be brutal to
// notice. Only Date.UTC() is used, and only to ask "how many days
// does this month have", which is timezone-independent.
function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const total = (m - 1) + months;
  const newYear = y + Math.floor(total / 12);
  const newMonth = (total % 12) + 1;
  const daysInNewMonth = new Date(Date.UTC(newYear, newMonth, 0)).getUTCDate();
  const newDay = Math.min(d, daysInNewMonth); // e.g. Aug 31 + 10mo doesn't exist in June -> clamps to June 30
  return `${newYear}-${String(newMonth).padStart(2, '0')}-${String(newDay).padStart(2, '0')}`;
}

async function createSchoolYear({ label, opensAt, closesAt }) {
  // "Automatically stop 10 months after classes began" unless an
  // admin typed a specific end date.
  const finalClosesAt = closesAt || addMonths(opensAt, 10);
  const result = await pool.query(
    `INSERT INTO school_years (label, opens_at, closes_at, is_active, enrollment_open)
     VALUES ($1, $2, $3, FALSE, FALSE)
     RETURNING id, label, opens_at, closes_at, is_active, enrollment_open`,
    [label, opensAt, finalClosesAt]
  );
  return result.rows[0];
}

async function isSchoolYearEditable(schoolYearId) {
  const result = await pool.query(
    'SELECT (closes_at > CURRENT_DATE) AS editable FROM school_years WHERE id = $1',
    [schoolYearId]
  );
  return result.rows[0]?.editable ?? false;
}

/** The dates of one school year as plain Y-M-D, read in Philippine time. */
async function getSchoolYearDates(id) {
  const { rows } = await pool.query(
    `SELECT id, label, dates_confirmed, ${HAS_STARTED} AS has_started,
            (opens_at  AT TIME ZONE 'Asia/Manila')::date::text AS opens_at,
            (closes_at AT TIME ZONE 'Asia/Manila')::date::text AS closes_at,
            classes_start_on::text AS classes_start_on
     FROM school_years WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Moves the dates of one school year.
 *
 * The end date can always be moved, because a year that is already running
 * may still need to finish earlier or later than planned. The start date can
 * only be moved while the year has not begun yet: once classes have started,
 * the day they started on is a matter of record, and every schedule, master
 * list and approved application already filed under the year depends on it.
 *
 * The year's name is the two calendar years of its dates, so a start date
 * that moved into a different calendar year would leave the name saying one
 * thing and the dates another. Only a year the system created by itself (its
 * dates still unconfirmed) may legitimately land in a different year — that
 * is the administrator entering the real dates for the first time, and the
 * name is recomputed with them. For a year whose dates have been confirmed
 * the move is refused instead, because silently renaming "2026-2027" to
 * "2027-2028" would rename it on every record that refers to it.
 */
async function updateSchoolYearDates(id, { opensAt, closesAt, classesStartOn }) {
  const year = await getSchoolYearDates(id);
  if (!year) return null;

  const movingStart = Boolean(opensAt) && opensAt !== year.opens_at;
  if (movingStart && year.has_started) {
    const err = new Error(
      `School year ${year.label} began on ${spellDate(year.opens_at)}, so its start date can no longer be `
      + 'changed. You can still change its end date.'
    );
    err.status = 409;
    err.reason = 'school_year_started';
    throw err;
  }

  const finalOpensAt = opensAt || year.opens_at;
  if (movingStart && year.dates_confirmed
      && schoolYearLabelFor(finalOpensAt) !== schoolYearLabelFor(year.opens_at)) {
    const err = new Error(
      `School year ${year.label} has to keep starting in ${year.opens_at.slice(0, 4)}, because its name and `
      + 'every record filed under it refer to that year. Pick a start date in that year, or add a separate '
      + 'school year instead.'
    );
    err.status = 409;
    err.reason = 'school_year_label_would_change';
    throw err;
  }

  if (closesAt <= finalOpensAt) {
    const err = new Error(
      `A school year cannot end on or before the day it starts. Pick an end date after ${spellDate(finalOpensAt)}.`
    );
    err.status = 400;
    throw err;
  }

  // The first day of classes is its own date: enrollment usually closes before
  // the children walk in. It has to sit inside the school year, and it cannot
  // be moved once that day has passed, for the same reason the start date
  // cannot — it is a matter of record by then.
  const finalClassesStartOn = classesStartOn || year.classes_start_on || finalOpensAt;
  // Moving only the end date can still leave the first day of classes outside
  // the year, so the date that will be stored is what gets checked, not just
  // the one that was sent.
  if (finalClassesStartOn && (finalClassesStartOn < finalOpensAt || finalClassesStartOn > closesAt)) {
    const err = new Error(
      `The first day of classes (${spellDate(finalClassesStartOn)}) would fall outside the school year. `
      + `Move it to a day between ${spellDate(finalOpensAt)} and ${spellDate(closesAt)}.`
    );
    err.status = 400;
    err.reason = 'classes_outside_year';
    throw err;
  }
  if (classesStartOn && classesStartOn !== year.classes_start_on) {
    if (year.classes_start_on && year.classes_start_on <= manilaToday()) {
      const err = new Error(
        `Classes for ${year.label} began on ${spellDate(year.classes_start_on)}, so that date can no longer be changed.`
      );
      err.status = 409;
      err.reason = 'classes_already_started';
      throw err;
    }
    if (classesStartOn < finalOpensAt || classesStartOn > closesAt) {
      const err = new Error(
        `The first day of classes has to fall inside the school year, between ${spellDate(finalOpensAt)} and ${spellDate(closesAt)}.`
      );
      err.status = 400;
      err.reason = 'classes_outside_year';
      throw err;
    }
  }

  // Every date goes in one statement so a refused set never half-applies, and
  // each is anchored to Philippine midnight the way every other date the
  // school types in is.
  const result = await pool.query(
    `UPDATE school_years
     SET opens_at  = ($2::date)::timestamp AT TIME ZONE 'Asia/Manila',
         closes_at = ($3::date)::timestamp AT TIME ZONE 'Asia/Manila',
         label = $4,
         classes_start_on = $6::date,
         dates_confirmed = CASE WHEN $5 THEN TRUE ELSE dates_confirmed END
     WHERE id = $1
     RETURNING id, label, opens_at, closes_at, classes_start_on::text AS classes_start_on,
               is_active, enrollment_open, dates_confirmed,
               (closes_at <= CURRENT_DATE) AS is_ended, ${HAS_STARTED} AS has_started`,
    [id, finalOpensAt, closesAt, schoolYearLabelFor(finalOpensAt), Boolean(opensAt), finalClassesStartOn]
  );
  return result.rows[0] || null;
}

async function setActiveSchoolYear(id) {
  // Only one school year is ever "active" at a time — flipping this
  // on for one row and off for every other row happens in the same
  // transaction so there is never a moment with zero or two active
  // years, even if this request races with another one.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE school_years SET is_active = FALSE WHERE is_active = TRUE');
    const result = await client.query(
      `UPDATE school_years SET is_active = TRUE WHERE id = $1
       RETURNING id, label, is_active`,
      [id]
    );
    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listGradeLevels() {
  const result = await pool.query('SELECT id, name FROM grade_levels ORDER BY sort_order');
  return result.rows;
}

async function listSectionsWithEnrollment(schoolYearId) {
  const seats = await sectionSeats(pool, schoolYearId);
  const { rows: advisers } = await pool.query(
    `SELECT s.id, s.adviser_teacher_id, t.first_name, t.last_name
     FROM sections s LEFT JOIN teachers t ON t.id = s.adviser_teacher_id
     WHERE s.school_year_id = $1`,
    [schoolYearId]
  );
  const adviserOf = Object.fromEntries(advisers.map((a) => [String(a.id), a]));
  return seats.map((s) => {
    const a = adviserOf[String(s.id)];
    return {
      id: s.id, name: s.name, capacity: s.capacity, grade_level_id: s.gradeLevelId,
      grade_level_name: s.gradeLevelName, enrolled_count: s.taken, slots_left: s.left,
      adviser_teacher_id: a && a.adviser_teacher_id ? a.adviser_teacher_id : null,
      adviser_name: a && a.first_name ? `${a.last_name}, ${a.first_name}` : null,
    };
  });
}

/**
 * A section name belongs to its grade level, not to the whole school year.
 *
 * Schools here number or name their sections per grade: Kinder may have a
 * section "1" and so may Grade 6, and both are ordinary. What is never
 * allowed is two sections with the same name inside ONE grade level, because
 * then "Grade 6 - 1" names two different classes and a master list cannot say
 * which. The database has a unique index for this; the check here exists so
 * the administrator gets a sentence rather than a constraint error.
 */
async function findSectionNameClash(name, schoolYearId, gradeLevelId, exceptId = null) {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, g.name AS grade_level_name
     FROM sections s JOIN grade_levels g ON g.id = s.grade_level_id
     WHERE s.school_year_id = $1
       AND s.grade_level_id = $2
       AND lower(btrim(s.name)) = lower(btrim($3))
       AND ($4::int IS NULL OR s.id <> $4)
     LIMIT 1`,
    [schoolYearId, gradeLevelId, name, exceptId]
  );
  return rows[0] || null;
}

async function createSection({ name, gradeLevelId, schoolYearId, capacity }) {
  const clash = await findSectionNameClash(name, schoolYearId, gradeLevelId);
  if (clash) {
    const err = new Error(`${clash.grade_level_name} already has a section called "${clash.name}". Two sections of the same grade level cannot share a name.`);
    err.status = 409;
    err.reason = 'duplicate_section_name';
    throw err;
  }
  const result = await pool.query(
    `INSERT INTO sections (name, grade_level_id, school_year_id, capacity)
     VALUES ($1, $2, $3, $4) RETURNING id, name, capacity`,
    [name, gradeLevelId, schoolYearId, capacity]
  );
  return result.rows[0];
}

async function updateSectionCapacity(id, capacity) {
  // A section can't be shrunk below how many are already enrolled
  // in it — that would silently make the section "over capacity"
  // without ever telling the admin why the number turned red.
  const enrolled = await pool.query(
    `SELECT COUNT(*)::int AS count FROM enrollment_applications
     WHERE section_id = $1 AND status IN (${SEAT_LIST})`,
    [id]
  );
  if (capacity < enrolled.rows[0].count) {
    const err = new Error(`This section already has ${enrolled.rows[0].count} enrolled. Capacity can't go below that.`);
    err.status = 409;
    throw err;
  }
  const result = await pool.query(
    'UPDATE sections SET capacity = $2 WHERE id = $1 RETURNING id, name, capacity',
    [id, capacity]
  );
  return result.rows[0] || null;
}

/**
 * Renames one section. The name rule is the one adding a section obeys: it
 * belongs to the grade level, so another grade may hold the same name, but
 * this grade may not hold it twice. The section's own id is excluded, so
 * saving a section under its current name (or only a change of letter case)
 * is not a clash with itself.
 */
async function updateSectionName(id, name) {
  const { rows: [section] } = await pool.query(
    'SELECT id, school_year_id, grade_level_id FROM sections WHERE id = $1', [id]
  );
  if (!section) return null;
  const clash = await findSectionNameClash(name, section.school_year_id, section.grade_level_id, id);
  if (clash) {
    const err = new Error(`${clash.grade_level_name} already has a section called "${clash.name}". Two sections of the same grade level cannot share a name.`);
    err.status = 409;
    err.reason = 'duplicate_section_name';
    throw err;
  }
  const result = await pool.query(
    'UPDATE sections SET name = $2 WHERE id = $1 RETURNING id, name, capacity',
    [id, String(name).trim()]
  );
  return result.rows[0] || null;
}

/**
 * The learners enrolled in one section: the approved applications that
 * point at it, by name.
 *
 * Deliberately only the name, sex and the date the enrollment was
 * approved. The LRN, birth date, contact number and address are
 * encrypted personal data and a "who is in this section" list has no
 * need of them, so they are never decrypted here.
 */
async function listSectionStudents(sectionId) {
  const { rows: [section] } = await pool.query(
    `SELECT s.id, s.name, s.capacity, g.name AS grade_level_name
     FROM sections s JOIN grade_levels g ON g.id = s.grade_level_id
     WHERE s.id = $1`,
    [sectionId]
  );
  if (!section) return null;
  const { rows } = await pool.query(
    `SELECT ea.id AS application_id, st.id AS student_id,
            st.first_name, st.middle_name, st.last_name, st.sex,
            COALESCE(ea.reviewed_at, ea.submitted_at) AS approved_at
     FROM enrollment_applications ea
     JOIN students st ON st.id = ea.student_id
     WHERE ea.section_id = $1 AND ea.status = 'approved'
     ORDER BY st.last_name, st.first_name, st.middle_name NULLS FIRST`,
    [sectionId]
  );
  return {
    section: {
      id: section.id, name: section.name, capacity: section.capacity,
      gradeLevelName: section.grade_level_name,
    },
    count: rows.length,
    students: rows.map((r) => ({
      applicationId: String(r.application_id),
      studentId: String(r.student_id),
      name: `${r.last_name}, ${r.first_name}${r.middle_name ? ` ${r.middle_name}` : ''}`,
      sex: r.sex === 'M' ? 'Male' : r.sex === 'F' ? 'Female' : '\u2014',
      approvedAt: r.approved_at,
    })),
  };
}

async function deleteSection(id) {
  // A section with real, currently-enrolled students can't just be
  // deleted — those application records would either orphan or (via
  // the FK) cascade-delete along with it, silently destroying real
  // enrollment data. A section with schedule_entries but no
  // enrollment (e.g. a section being restructured before the year
  // starts) is fine to remove; those rows cascade-delete via the
  // existing schedule_entries.section_id FK, the same way removing
  // a subject frees up whatever it was linked to.
  const { rows: [section] } = await pool.query('SELECT id, name FROM sections WHERE id = $1', [id]);
  if (!section) return null;
  const enrolled = await pool.query(
    `SELECT COUNT(*)::int AS count FROM enrollment_applications
     WHERE section_id = $1 AND status IN (${SEAT_LIST})`,
    [id]
  );
  const { count } = enrolled.rows[0];
  if (count > 0) {
    const err = new Error(
      `${section.name} has ${count} learner${count === 1 ? '' : 's'} placed in it, so it cannot be removed. `
      + 'Move them to another section of this grade level first, and then remove this one.'
    );
    err.status = 409;
    err.reason = 'section_has_learners';
    throw err;
  }
  const result = await pool.query('DELETE FROM sections WHERE id = $1 RETURNING id', [id]);
  return result.rows[0] || null;
}

/**
 * Which other section of the same school year this teacher already advises,
 * if any. A teacher advises at most one section, so this is what makes
 * "already an adviser elsewhere" answerable by name rather than by id.
 */
async function adviserConflict(sectionId, teacherId) {
  const { rows } = await pool.query(
    `SELECT other.name, g.name AS grade_level_name
     FROM sections other
     JOIN grade_levels g ON g.id = other.grade_level_id
     WHERE other.adviser_teacher_id = $2
       AND other.id <> $1
       AND other.school_year_id = (SELECT school_year_id FROM sections WHERE id = $1)
     LIMIT 1`,
    [sectionId, teacherId]
  );
  return rows[0] || null;
}

/**
 * Sets, or clears, the adviser of one section.
 *
 * An adviser is the teacher responsible for one class for the whole school
 * year, so nobody can hold two of those at once: a second section would mean
 * two class advisories, two master lists and two sets of parents expecting
 * the same person. The teacher has to be let go of the section they already
 * advise before they can take another.
 */
async function setSectionAdviser(sectionId, teacherId) {
  if (teacherId !== null) {
    const { rows } = await pool.query(
      'SELECT id, is_active, status, first_name, last_name FROM teachers WHERE id = $1', [teacherId]
    );
    if (!rows[0]) {
      const err = new Error('That teacher was not found.');
      err.status = 404;
      throw err;
    }
    // Both halves, the same test the schedule uses: a teacher who is not
    // currently teaching cannot be handed a section to look after.
    if (!rows[0].is_active || rows[0].status !== 'active') {
      const err = new Error('That teacher is not currently teaching and cannot be made an adviser.');
      err.status = 409;
      throw err;
    }
    const held = await adviserConflict(sectionId, teacherId);
    if (held) {
      const teacher = `${rows[0].last_name}, ${rows[0].first_name}`;
      const err = new Error(
        `${teacher} already advises ${held.grade_level_name} – ${held.name}. A teacher can advise only one `
        + 'section, so set that section’s adviser to somebody else first, or choose another teacher here.'
      );
      err.status = 409;
      err.reason = 'adviser_already_assigned';
      throw err;
    }
  }
  const { rows } = await pool.query(
    `UPDATE sections SET adviser_teacher_id = $2 WHERE id = $1
     RETURNING id, name, adviser_teacher_id`,
    [sectionId, teacherId]
  );
  return rows[0] || null;
}

/** Active teachers, for the adviser drop-down. */
async function listTeacherOptions() {
  const { rows } = await pool.query(
    `SELECT id, first_name, last_name
     FROM teachers WHERE is_active AND status = 'active'
     ORDER BY last_name, first_name`
  );
  return rows.map((t) => ({ id: t.id, name: `${t.last_name}, ${t.first_name}` }));
}

module.exports = {
  listSchoolYears, createSchoolYear, setActiveSchoolYear, isSchoolYearEditable,
  getSchoolYearDates, updateSchoolYearDates,
  listGradeLevels, listSectionsWithEnrollment, createSection, updateSectionCapacity, deleteSection,
  findSectionNameClash, setSectionAdviser, listTeacherOptions,
  updateSectionName, listSectionStudents,
};
