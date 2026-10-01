const pool = require('../pool');
const { getActiveSchoolYear } = require('./settings');

const SCHOOL_DAYS_PER_WEEK = 5;

// The single busiest day this teacher currently has, in the active
// school year — used to stop an admin from lowering a teacher's
// daily cap below what's already scheduled. Existing periods aren't
// touched automatically; the admin has to remove enough of them
// first, the same way shrinking a section's capacity below its
// current enrollment is blocked rather than silently accepted.
async function getBusiestDayCount(teacherId, schoolYearId) {
  const result = await pool.query(
    `SELECT day, COUNT(*)::int AS count
     FROM schedule_entries, unnest(days) AS day
     WHERE teacher_id = $1 AND school_year_id = $2 AND role_type = 'subject'
     GROUP BY day ORDER BY count DESC LIMIT 1`,
    [teacherId, schoolYearId]
  );
  return result.rows[0]?.count || 0;
}

async function listTeachers(search, schoolYearId) {
  const params = [];
  let where = '';
  if (search) {
    params.push(`%${search}%`);
    where = `WHERE t.first_name ILIKE $1 OR t.last_name ILIKE $1 OR t.email ILIKE $1`;
  }
  params.push(schoolYearId || null);
  const yearParamIndex = params.length;
  const result = await pool.query(
    `SELECT t.id, t.first_name, t.middle_name, t.last_name, t.email, t.is_active, t.status, t.max_periods_per_day,
            (t.max_periods_per_day * ${SCHOOL_DAYS_PER_WEEK}) AS weekly_load_cap,
            COALESCE(array_agg(DISTINCT gl.name) FILTER (WHERE gl.name IS NOT NULL), '{}') AS grade_levels,
            COALESCE(array_agg(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL), '{}') AS subjects,
            COUNT(DISTINCT se.id)::int AS weekly_load
     FROM teachers t
     LEFT JOIN teacher_subjects ts ON ts.teacher_id = t.id
     LEFT JOIN subjects s ON s.id = ts.subject_id
     LEFT JOIN grade_levels gl ON gl.id = s.grade_level_id
     LEFT JOIN schedule_entries se ON se.teacher_id = t.id AND se.role_type = 'subject'
       AND ($${yearParamIndex}::smallint IS NULL OR se.school_year_id = $${yearParamIndex})
     ${where}
     GROUP BY t.id
     ORDER BY t.last_name, t.first_name`,
    params
  );
  return result.rows;
}

async function getTeacherById(id) {
  const result = await pool.query(
    `SELECT id, first_name, middle_name, last_name, email,
            pgp_sym_decrypt(contact_number, $2)::text AS contact_number,
            degree, major, date_hired, is_active, status, sex, prc_license_number, max_periods_per_day,
            pgp_sym_decrypt(address, $2)::text AS address,
            COALESCE((SELECT array_agg(subject_id) FROM teacher_subjects WHERE teacher_id = teachers.id), '{}') AS subject_ids
     FROM teachers WHERE id = $1`,
    [id, process.env.ENCRYPTION_KEY]
  );
  return result.rows[0] || null;
}

async function findTeacherByEmail(email) {
  const result = await pool.query('SELECT id FROM teachers WHERE email = $1', [email]);
  return result.rows[0] || null;
}

/**
 * Checks for a duplicate name or contact number among teachers,
 * excluding the record currently being edited (if any). Contact
 * number is encrypted at rest with non-deterministic ciphertext
 * (pgp_sym_encrypt includes a random session key), so two identical
 * numbers never encrypt to the same bytes — matching has to happen
 * on the decrypted value in application code, not as a SQL WHERE
 * equality. At single-school roster scale (tens to low hundreds of
 * teachers) decrypting the whole table for this check is cheap;
 * it would need rethinking well before that stopped being true.
 */
async function findDuplicateTeacher({ firstName, lastName, contactNumber, prcLicenseNumber, excludeId }) {
  const key = process.env.ENCRYPTION_KEY;
  const result = await pool.query(
    `SELECT id, first_name, last_name, prc_license_number,
            pgp_sym_decrypt(contact_number, $1)::text AS contact_number
     FROM teachers WHERE ($2::int IS NULL OR id <> $2)`,
    [key, excludeId || null]
  );
  const norm = (s) => (s || '').trim().toLowerCase();
  const targetName = `${norm(firstName)} ${norm(lastName)}`;
  const targetPrc = (prcLicenseNumber || '').trim();
  for (const row of result.rows) {
    if (`${norm(row.first_name)} ${norm(row.last_name)}` === targetName) {
      return { field: 'name', existing: row };
    }
    if (contactNumber && row.contact_number === contactNumber) {
      return { field: 'contactNumber', existing: row };
    }
    // prc_license_number isn't encrypted (it's not the kind of PII
    // contact_number/address are), so this compares directly rather
    // than needing the decrypt-then-compare dance those two need.
    if (targetPrc && row.prc_license_number && row.prc_license_number.trim() === targetPrc) {
      return { field: 'prcLicenseNumber', existing: row };
    }
  }
  return null;
}

async function createTeacher(db, {
  firstName, lastName, middleName, email, contactNumber, degree, major,
  dateHired, sex, prcLicenseNumber, address, maxPeriodsPerDay, createdBy,
}) {
  const key = process.env.ENCRYPTION_KEY;
  const result = await db.query(
    `INSERT INTO teachers (
       first_name, middle_name, last_name, email, contact_number, degree, major,
       date_hired, sex, prc_license_number, address, max_periods_per_day, created_by
     )
     VALUES ($1, $2, $3, $4, pgp_sym_encrypt($5::text, $13), $6, $7, $8, $9, $10,
             CASE WHEN $11::text IS NULL THEN NULL ELSE pgp_sym_encrypt($11::text, $13) END,
             COALESCE($12, 5), $14)
     RETURNING id, first_name, last_name, email`,
    [
      firstName, middleName || null, lastName, email, contactNumber || null, degree || null, major || null,
      dateHired || null, sex || null, prcLicenseNumber || null, address || null, maxPeriodsPerDay || null, key, createdBy,
    ]
  );
  return result.rows[0];
}

async function setTeacherSubjects(db, teacherId, subjectIds) {
  await db.query('DELETE FROM teacher_subjects WHERE teacher_id = $1', [teacherId]);
  for (const subjectId of subjectIds) {
    await db.query(
      'INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [teacherId, subjectId]
    );
  }
}

async function updateTeacher(db, id, fields) {
  if (fields.maxPeriodsPerDay !== undefined) {
    const activeYear = await getActiveSchoolYear();
    if (activeYear) {
      const busiest = await getBusiestDayCount(id, activeYear.id);
      if (fields.maxPeriodsPerDay < busiest) {
        const err = new Error(
          `This teacher already has ${busiest} periods on their busiest day. `
          + `Remove some of their scheduled classes before lowering the limit below ${busiest}.`
        );
        err.status = 409;
        throw err;
      }
    }
  }

  const sets = [];
  const params = [id];
  const key = process.env.ENCRYPTION_KEY;

  // Setting status also sets is_active to match, unless isActive
  // was explicitly sent too — that keeps every place that already
  // reads the plain is_active boolean (the weekly-load bar, the
  // Teachers list's "Inactive" pill) correct without having to
  // rewrite them to understand the three-value status as well.
  const derivedIsActive = fields.isActive !== undefined
    ? fields.isActive
    : fields.status !== undefined ? fields.status === 'active' : undefined;

  const plain = {
    first_name: fields.firstName, middle_name: fields.middleName, last_name: fields.lastName,
    email: fields.email, degree: fields.degree, major: fields.major, date_hired: fields.dateHired,
    sex: fields.sex, prc_license_number: fields.prcLicenseNumber, max_periods_per_day: fields.maxPeriodsPerDay,
    status: fields.status, is_active: derivedIsActive,
  };
  for (const [col, val] of Object.entries(plain)) {
    if (val !== undefined) {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (fields.contactNumber !== undefined) {
    params.push(fields.contactNumber, key);
    sets.push(`contact_number = pgp_sym_encrypt($${params.length - 1}::text, $${params.length})`);
  }
  if (fields.address !== undefined) {
    params.push(fields.address, key);
    sets.push(`address = pgp_sym_encrypt($${params.length - 1}::text, $${params.length})`);
  }
  if (sets.length === 0) return { ...(await getTeacherById(id)), clearedSchedules: 0 };

  sets.push('updated_at = NOW()');
  const result = await db.query(
    `UPDATE teachers SET ${sets.join(', ')} WHERE id = $1 RETURNING id`,
    params
  );
  if (!result.rows[0]) return null;

  // Retiring a teacher clears every class they were still assigned
  // to, across every grade/section — the room they were teaching
  // still needs a live teacher in it, so those periods need to show
  // up as open again for the admin to reassign, not silently keep
  // pointing at someone no longer teaching. Coming back from
  // "retired" does not restore anything: re-assigning is a fresh,
  // deliberate action through Class Schedules, same as hiring
  // someone new into that slot would be.
  let clearedSchedules = 0;
  if (fields.status === 'retired') {
    const deleted = await db.query('DELETE FROM schedule_entries WHERE teacher_id = $1', [id]);
    clearedSchedules = deleted.rowCount;
  }

  return { ...result.rows[0], clearedSchedules };
}

async function getTeacherWeeklySchedule(teacherId, schoolYearId) {
  const result = await pool.query(
    `SELECT se.id, se.session, se.days, se.start_time, se.end_time, se.room, se.role_type,
            sub.name AS subject_name, sec.name AS section_name, gl.name AS grade_level_name
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
  listTeachers, getTeacherById, findTeacherByEmail, findDuplicateTeacher,
  createTeacher, updateTeacher, setTeacherSubjects, getTeacherWeeklySchedule,
};