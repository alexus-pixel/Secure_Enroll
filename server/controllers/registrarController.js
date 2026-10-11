const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { notifyLrnRecorded } = require('../mailer');

const AY = `(SELECT id FROM school_years WHERE is_active LIMIT 1)`;
const REQUIRED = [
  { type: 'birth_certificate', name: 'Birth Certificate' },
  { type: 'form_138', name: 'Form 138 / Report Card' },
  { type: 'good_moral', name: 'Certificate of Good Moral' },
];
const DOC_OUT = { pending: 'pending', verified: 'verified', rejected: 'flagged' };
const DOC_IN = { verified: 'verified', flagged: 'rejected' };

function audit(db, req, action, entityId, details) {
  return db.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, user_agent, details)
     VALUES ($1,$2,'enrollment_application',$3,$4,$5,$6)`,
    [req.user.id, action, entityId, req.ip, req.headers['user-agent'], JSON.stringify(details || {})]
  );
}

// ---------- Dashboard ----------
exports.list = async (req, res) => {
  const stats = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE submitted_at > NOW() - INTERVAL '7 days')::int AS "newThisWeek",
       COUNT(*) FILTER (WHERE status = 'under_review')::int   AS "underReview",
       COUNT(*) FILTER (WHERE status = 'needs_revision')::int AS "needsRevision",
       COUNT(*) FILTER (WHERE status = 'approved')::int       AS approved
     FROM enrollment_applications WHERE school_year_id = ${AY}`
  );
  const apps = await pool.query(
    `SELECT a.id, s.last_name || ', ' || s.first_name AS student,
            s.lrn_hash IS NULL AS "missingLrn",
            g.name AS grade,
            gd.first_name || ' ' || gd.last_name AS guardian,
            a.submitted_at AS submitted, a.status
     FROM enrollment_applications a
     JOIN students s ON s.id = a.student_id
     JOIN grade_levels g ON g.id = a.grade_level_id
     LEFT JOIN guardians gd ON gd.user_id = a.submitted_by
     WHERE a.school_year_id = ${AY}
     ORDER BY a.submitted_at DESC`
  );
  res.json({ stats: stats.rows[0], applications: apps.rows });
};

// ---------- Application view ----------
exports.get = async (req, res) => {
  const { rows: [a] } = await pool.query(
    `SELECT a.id, a.status, a.remarks, a.grade_qualification AS "gradeQualification",
            a.submitted_at AS submitted,
            s.id AS "studentId",
            s.lrn_hash IS NULL AS "missingLrn",
            s.last_name || ', ' || s.first_name AS student, g.name AS grade,
            gd.first_name || ' ' || gd.last_name AS guardian
     FROM enrollment_applications a
     JOIN students s ON s.id = a.student_id
     JOIN grade_levels g ON g.id = a.grade_level_id
     LEFT JOIN guardians gd ON gd.user_id = a.submitted_by
     WHERE a.id = $1`,
    [req.params.id]
  );
  if (!a) return res.status(404).json({ message: 'Application not found.' });

  const { rows: docs } = await pool.query(
    `SELECT doc_type, file_path, status, uploaded_at, received_in_person
     FROM documents WHERE application_id = $1`,
    [a.id]
  );
  a.documents = REQUIRED.map((r) => {
    const d = docs.find((x) => x.doc_type === r.type);
    if (!d) return { id: r.type, name: r.name, file: null, uploaded: null, status: 'awaiting' };
    return {
      id: r.type,
      name: r.name,
      file: d.file_path ? path.basename(d.file_path) : null,
      receivedInPerson: d.received_in_person,
      uploaded: d.uploaded_at,
      status: DOC_OUT[d.status],
    };
  });
  res.json(a);
};

exports.setDocumentStatus = async (req, res) => {
  const status = DOC_IN[req.body.status];
  if (!status) return res.status(400).json({ message: 'Status must be verified or flagged.' });
  const { rowCount } = await pool.query(
    `UPDATE documents SET status = $1, verified_by = $2, verified_at = NOW()
     WHERE application_id = $3 AND doc_type = $4`,
    [status, req.user.id, req.params.id, req.params.docType]
  );
  if (!rowCount) return res.status(404).json({ message: 'Document not found.' });
  await audit(pool, req, 'DOCUMENT_' + status.toUpperCase(), req.params.id, { docType: req.params.docType });
  res.json({ ok: true });
};

exports.setQualification = async (req, res) => {
  if (!['met', 'not_met'].includes(req.body.value)) {
    return res.status(400).json({ message: 'Value must be met or not_met.' });
  }
  const { rowCount } = await pool.query(
    'UPDATE enrollment_applications SET grade_qualification = $1 WHERE id = $2',
    [req.body.value, req.params.id]
  );
  if (!rowCount) return res.status(404).json({ message: 'Application not found.' });
  res.json({ ok: true });
};

exports.decide = async (req, res) => {
  const { action, remarks = '' } = req.body;
  const status = { approve: 'approved', revision: 'needs_revision', reject: 'rejected' }[action];
  if (!status) return res.status(400).json({ message: 'Unknown action.' });

  const { rows: [a] } = await pool.query(
    'SELECT status, grade_qualification FROM enrollment_applications WHERE id = $1',
    [req.params.id]
  );
  if (!a) return res.status(404).json({ message: 'Application not found.' });
  if (['approved', 'rejected'].includes(a.status)) {
    return res.status(409).json({ message: 'This application is already finalized.' });
  }

  if (action === 'approve') {
    const { rows: [c] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM documents
       WHERE application_id = $1 AND status = 'verified' AND doc_type = ANY($2)`,
      [req.params.id, REQUIRED.map((r) => r.type)]
    );
    if (c.n < REQUIRED.length || a.grade_qualification !== 'met') {
      return res.status(400).json({
        message: 'Verify all documents and mark the grade qualification as Met before approving.',
      });
    }
  } else if (!remarks.trim()) {
    return res.status(400).json({ message: 'A remark is required.' });
  }

  await pool.query(
    `UPDATE enrollment_applications
     SET status = $1, remarks = NULLIF($2, ''), reviewed_by = $3, reviewed_at = NOW()
     WHERE id = $4`,
    [status, remarks.trim(), req.user.id, req.params.id]
  );
  await audit(pool, req, 'APPLICATION_' + status.toUpperCase(), req.params.id, { remarks });
  res.json({ ok: true, status });
};

// ---------- Walk-in: new student ----------
exports.walkIn = async (req, res) => {
  const b = req.body;
  const required = ['firstName', 'lastName', 'birthDate', 'guardianFirst', 'guardianLast', 'contact'];
  if (required.some((k) => !String(b[k] || '').trim())) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }
  const key = process.env.ENCRYPTION_KEY;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [role] } = await client.query(`SELECT id FROM roles WHERE name = 'parent'`);
    const { rows: [grade] } = await client.query('SELECT id FROM grade_levels WHERE name = $1', [b.grade]);
    if (!grade) throw Object.assign(new Error('Invalid grade level.'), { status: 400 });

    // The parent account is created inactive. Credentials are issued later.
    const email = (b.email || `walkin-${crypto.randomUUID()}@walkin.invalid`).toLowerCase();
    const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    const { rows: [user] } = await client.query(
      `INSERT INTO users (email, password_hash, role_id, is_active)
       VALUES ($1,$2,$3,FALSE) RETURNING id`,
      [email, hash, role.id]
    );
    await client.query(
      `INSERT INTO guardians (user_id, first_name, last_name, contact_number, address)
       VALUES ($1,$2,$3, pgp_sym_encrypt($4,$6), pgp_sym_encrypt($5,$6))`,
      [user.id, b.guardianFirst.trim(), b.guardianLast.trim(), b.contact, b.address || '', key]
    );
    const { rows: [student] } = await client.query(
      `INSERT INTO students (first_name, middle_name, last_name, birth_date, sex)
       VALUES ($1,$2,$3, pgp_sym_encrypt($4,$6), $5) RETURNING id`,
      [b.firstName.trim(), b.middleName?.trim() || null, b.lastName.trim(), b.birthDate,
       b.sex === 'Male' ? 'M' : 'F', key]
    );
    await client.query(
      `INSERT INTO student_guardians (student_id, guardian_id, relationship, is_primary)
       VALUES ($1,$2,$3,TRUE)`,
      [student.id, user.id, b.relationship || 'Guardian']
    );
    const { rows: [app] } = await client.query(
      `INSERT INTO enrollment_applications (student_id, school_year_id, grade_level_id, submitted_by)
       VALUES ($1, ${AY}, $2, $3) RETURNING id`,
      [student.id, grade.id, user.id]
    );

    const received = { birth_certificate: b.docs?.birth, form_138: b.docs?.form138, good_moral: b.docs?.moral };
    for (const [type, ok] of Object.entries(received)) {
      if (ok) {
        await client.query(
          `INSERT INTO documents (application_id, doc_type, received_in_person) VALUES ($1,$2,TRUE)`,
          [app.id, type]
        );
      }
    }
    await audit(client, req, 'WALK_IN_CREATED', app.id, {});
    await client.query('COMMIT');
    res.status(201).json({ applicationId: app.id });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') return res.status(409).json({ message: 'That record already exists.' });
    throw err;
  } finally {
    client.release();
  }
};

// ---------- Walk-in: returning student ----------
exports.lookupLearner = async (req, res) => {
  const hash = crypto.createHash('sha256').update(req.params.lrn.trim()).digest('hex');
  const { rows: [l] } = await pool.query(
    `SELECT s.id AS "studentId", s.first_name || ' ' || s.last_name AS name,
            g.name AS grade, g.sort_order AS "gradeOrder",
            sec.name AS section, sy.label AS "schoolYear"
     FROM students s
     JOIN enrollment_applications a ON a.student_id = s.id
     JOIN grade_levels g ON g.id = a.grade_level_id
     JOIN school_years sy ON sy.id = a.school_year_id
     LEFT JOIN sections sec ON sec.id = a.section_id
     WHERE s.lrn_hash = $1
     ORDER BY sy.opens_at DESC LIMIT 1`,
    [hash]
  );
  if (!l) return res.status(404).json({ message: 'No record found for that LRN.' });
  res.json(l);
};

exports.promote = async (req, res) => {
  if (!req.body.form138) {
    return res.status(400).json({ message: 'Form 138 must be received first.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [prev] } = await client.query(
      `SELECT a.id, g.sort_order FROM enrollment_applications a
       JOIN grade_levels g ON g.id = a.grade_level_id
       JOIN school_years sy ON sy.id = a.school_year_id
       WHERE a.student_id = $1 ORDER BY sy.opens_at DESC LIMIT 1`,
      [req.params.studentId]
    );
    const { rows: [next] } = await client.query(
      'SELECT id FROM grade_levels WHERE sort_order = $1',
      [prev ? prev.sort_order + 1 : -1]
    );
    const { rows: [guardian] } = await client.query(
      `SELECT guardian_id FROM student_guardians
       WHERE student_id = $1 ORDER BY is_primary DESC LIMIT 1`,
      [req.params.studentId]
    );
    if (!prev || !next || !guardian) {
      throw Object.assign(new Error('This learner cannot be promoted.'), { status: 400 });
    }

    const { rows: [app] } = await client.query(
      `INSERT INTO enrollment_applications (student_id, school_year_id, grade_level_id, submitted_by)
       VALUES ($1, ${AY}, $2, $3) RETURNING id`,
      [req.params.studentId, next.id, guardian.guardian_id]
    );
    // Carry over documents that are already verified and on file
    await client.query(
      `INSERT INTO documents (application_id, doc_type, file_path, mime_type, file_size, checksum,
                              status, verified_by, verified_at, received_in_person)
       SELECT $1, doc_type, file_path, mime_type, file_size, checksum,
              status, verified_by, verified_at, received_in_person
       FROM documents
       WHERE application_id = $2 AND status = 'verified'
         AND doc_type IN ('birth_certificate','good_moral')`,
      [app.id, prev.id]
    );
    await client.query(
      `INSERT INTO documents (application_id, doc_type, received_in_person) VALUES ($1,'form_138',TRUE)`,
      [app.id]
    );
    await audit(client, req, 'WALK_IN_PROMOTION', app.id, {});
    await client.query('COMMIT');
    res.status(201).json({ applicationId: app.id });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') {
      return res.status(409).json({ message: 'This learner is already enrolled this school year.' });
    }
    throw err;
  } finally {
    client.release();
  }
};

// ---------- Account settings ----------
exports.updateProfile = async (req, res) => {
  const { firstName, lastName, middleInitial = '' } = req.body;
  if (!firstName?.trim() || !lastName?.trim()) {
    return res.status(400).json({ message: 'First and last name are required.' });
  }
  const { rows: [u] } = await pool.query(
    `UPDATE users SET first_name = $1, last_name = $2, middle_initial = NULLIF($3,''), updated_at = NOW()
     WHERE id = $4
     RETURNING id, email, first_name, last_name, middle_initial`,
    [firstName.trim(), lastName.trim(), middleInitial.trim(), req.user.id]
  );
  res.json(u);
};

exports.changePassword = async (req, res) => {
  const { current, next } = req.body;
  if (!next || next.length < 8) {
    return res.status(400).json({ message: 'New password must be at least 8 characters.' });
  }
  const { rows: [u] } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(current || '', u.password_hash))) {
    return res.status(400).json({ message: 'Current password is incorrect.' });
  }
  await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
    await bcrypt.hash(next, 12),
    req.user.id,
  ]);
  res.json({ ok: true });
};

// ---------- Missing LRN ----------
const LRN_FORMAT = /^\d{12}$/;

// Students in the active school year who still have no LRN.
exports.listMissingLrn = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id AS "studentId",
            s.last_name || ', ' || s.first_name AS student,
            g.name AS grade,
            a.id AS "applicationId",
            a.status,
            a.submitted_at AS submitted
     FROM enrollment_applications a
     JOIN students s ON s.id = a.student_id
     JOIN grade_levels g ON g.id = a.grade_level_id
     WHERE a.school_year_id = ${AY}
       AND s.lrn_hash IS NULL
       AND a.status NOT IN ('draft', 'rejected')
       -- AND g.sort_order <= 1   -- uncomment to limit to Kinder and Grade 1
     ORDER BY g.sort_order, s.last_name, s.first_name`
  );
  res.json({ count: rows.length, students: rows });
};

// The registrar types in the LRN she got from the DepEd LIS portal.
exports.setLrn = async (req, res) => {
  if (!/^\d+$/.test(req.params.studentId)) {
    return res.status(404).json({ message: 'Student not found.' });
  }
  const lrn = String(req.body.lrn || '').trim();
  if (!LRN_FORMAT.test(lrn)) {
    return res.status(400).json({ message: 'LRN must be exactly 12 digits.' });
  }
  // Same hashing as lookupLearner, so returning-student lookup works afterwards.
  const hash = crypto.createHash('sha256').update(lrn).digest('hex');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [s] } = await client.query(
      'SELECT lrn_hash FROM students WHERE id = $1 FOR UPDATE',
      [req.params.studentId]
    );
    if (!s) throw Object.assign(new Error('Student not found.'), { status: 404 });
    if (s.lrn_hash) throw Object.assign(new Error('This student already has an LRN.'), { status: 409 });

    await client.query(
      `UPDATE students
       SET lrn_encrypted = pgp_sym_encrypt($1::text, $2), lrn_hash = $3, updated_at = NOW()
       WHERE id = $4`,
      [lrn, process.env.ENCRYPTION_KEY, hash, req.params.studentId]
    );

    // Never put the LRN itself in the audit log.
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, user_agent, details)
       VALUES ($1, 'LRN_ENCODED', 'student', $2, $3, $4, '{}')`,
      [req.user.id, req.params.studentId, req.ip, req.headers['user-agent']]
    );

    await client.query('COMMIT');
    notifyLrnRecorded(req.params.studentId); // runs in the background, never throws
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') {
      return res.status(409).json({ message: 'That LRN already belongs to another student.' });
    }
    throw err;
  } finally {
    client.release();
  }
};