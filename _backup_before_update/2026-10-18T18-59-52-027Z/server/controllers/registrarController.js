const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { notifyLrnRecorded } = require('../mailer');
const { UPLOAD_DIR } = require('../middleware/upload');
const {
  isValidName, passwordIssues, PASSWORD_MAX_BYTES, NOTE_MAX, REMARK_MAX,
} = require('../utils/validators');

const AY = `(SELECT id FROM school_years WHERE is_active LIMIT 1)`;

// The three documents every application is reviewed against. Anything
// else on file (for example a valid ID handed over at a walk-in) is
// listed after these.
const CORE_DOCS = [
  { type: 'birth_certificate', name: 'Birth Certificate' },
  { type: 'form_138', name: 'Form 138 / Report Card' },
  { type: 'good_moral', name: 'Certificate of Good Moral' },
];
// users.middle_initial is VARCHAR(2)
const MI_MAX = 2;
const DOC_STATUSES = ['pending', 'verified', 'flagged', 'rejected'];

// Primary guardian of a student, whoever submitted the application
// (a parent online, or staff at a walk-in).
const GUARDIAN_JOIN = `
  LEFT JOIN LATERAL (
    SELECT g.first_name, g.last_name
    FROM student_guardians sg
    JOIN guardians g ON g.user_id = sg.guardian_id
    WHERE sg.student_id = s.id
    ORDER BY sg.is_primary DESC, sg.guardian_id
    LIMIT 1
  ) gd ON TRUE`;

function audit(db, req, action, entityId, details, entityType = 'enrollment_application') {
  return db.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, user_agent, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [req.user.id, action, entityType, entityId, req.ip, req.headers['user-agent'], JSON.stringify(details || {})]
  );
}

// Newest document row per type. A parent who re-uploads after a
// rejection adds a row; the registrar always reviews the latest one.
// 'resubmitted' is true for a pending copy that replaced a flagged or rejected one.
const LATEST_DOCS = `
  SELECT DISTINCT ON (d.doc_type)
         d.id, d.doc_type, d.file_path, d.mime_type, d.status, d.uploaded_at, d.review_note,
         (d.received_in_person OR d.is_physical) AS physical,
         (d.status = 'pending' AND EXISTS (
            SELECT 1 FROM documents p
            WHERE p.application_id = d.application_id AND p.doc_type = d.doc_type
              AND p.id <> d.id AND p.status IN ('flagged', 'rejected'))) AS resubmitted
  FROM documents d
  WHERE d.application_id = $1
  ORDER BY d.doc_type, d.uploaded_at DESC, d.id DESC`;

// A reason for flagging or rejecting must say something: at least 3 words.
const MIN_REASON_WORDS = 3;
const countWords = (text) => text.trim().split(/\s+/).filter(Boolean).length;

// ---------- Dashboard ----------
exports.list = async (req, res) => {
  const stats = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE submitted_at > NOW() - INTERVAL '7 days')::int AS "newThisWeek",
       COUNT(*) FILTER (WHERE status IN ('under_review', 'resubmitted'))::int AS "underReview",
       COUNT(*) FILTER (WHERE status = 'needs_revision')::int AS "needsRevision",
       COUNT(*) FILTER (WHERE status = 'approved')::int       AS approved
     FROM enrollment_applications WHERE school_year_id = ${AY}`
  );
  const apps = await pool.query(
    `SELECT a.id, s.last_name || ', ' || s.first_name AS student,
            s.lrn_hash IS NULL AS "missingLrn",
            g.name AS grade,
            COALESCE(gd.first_name || ' ' || gd.last_name, '—') AS guardian,
            a.submitted_at AS submitted, a.status
     FROM enrollment_applications a
     JOIN students s ON s.id = a.student_id
     JOIN grade_levels g ON g.id = a.grade_level_id
     ${GUARDIAN_JOIN}
     WHERE a.school_year_id = ${AY}
     ORDER BY a.submitted_at DESC`
  );
  res.json({ stats: stats.rows[0], applications: apps.rows });
};

// ---------- Application view ----------
exports.get = async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ message: 'Application not found.' });
  const { rows: [a] } = await pool.query(
    `SELECT a.id, a.status, a.remarks, a.grade_qualification AS "gradeQualification",
            a.submitted_at AS submitted,
            s.id AS "studentId",
            s.lrn_hash IS NULL AS "missingLrn",
            s.last_name || ', ' || s.first_name AS student, g.name AS grade,
            COALESCE(gd.first_name || ' ' || gd.last_name, '—') AS guardian
     FROM enrollment_applications a
     JOIN students s ON s.id = a.student_id
     JOIN grade_levels g ON g.id = a.grade_level_id
     ${GUARDIAN_JOIN}
     WHERE a.id = $1`,
    [req.params.id]
  );
  if (!a) return res.status(404).json({ message: 'Application not found.' });

  const { rows: docs } = await pool.query(LATEST_DOCS, [a.id]);
  const { rows: types } = await pool.query('SELECT code, label FROM required_document_types');
  const labelOf = Object.fromEntries(types.map((t) => [t.code, t.label]));

  const shape = (type, name) => {
    const d = docs.find((x) => x.doc_type === type);
    if (!d) return { type, name, status: 'awaiting', hasFile: false, receivedInPerson: false };
    return {
      type,
      name,
      docId: d.id,
      hasFile: Boolean(d.file_path),
      mimeType: d.mime_type,
      receivedInPerson: d.physical,
      uploaded: d.uploaded_at,
      status: d.status,
      resubmitted: Boolean(d.resubmitted),
      note: d.review_note,
    };
  };

  const coreTypes = CORE_DOCS.map((c) => c.type);
  a.documents = [
    ...CORE_DOCS.map((c) => shape(c.type, c.name)),
    ...docs
      .filter((d) => !coreTypes.includes(d.doc_type))
      .map((d) => shape(d.doc_type, labelOf[d.doc_type] || d.doc_type)),
  ];
  res.json(a);
};

// Verify, flag (needs attention) or reject (must be replaced) one document.
exports.setDocumentStatus = async (req, res) => {
  const { status } = req.body || {};
  const rawNote = req.body && req.body.note;
  if (rawNote !== undefined && rawNote !== null && typeof rawNote !== 'string') {
    return res.status(400).json({ message: 'The note must be text.' });
  }
  const note = (rawNote || '').trim();
  if (note.length > NOTE_MAX) {
    return res.status(400).json({ message: `The note is too long (up to ${NOTE_MAX} characters).` });
  }
  if (!DOC_STATUSES.includes(status)) {
    return res.status(400).json({ message: 'Status must be verified, flagged, rejected or pending.' });
  }
  if ((status === 'flagged' || status === 'rejected') && countWords(note) < MIN_REASON_WORDS) {
    return res.status(400).json({
      message: `Give a reason of at least ${MIN_REASON_WORDS} words to ${status === 'flagged' ? 'flag' : 'reject'} a document.`,
    });
  }
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ message: 'Application not found.' });

  const { rows: [app] } = await pool.query(
    'SELECT status FROM enrollment_applications WHERE id = $1', [req.params.id]
  );
  if (!app) return res.status(404).json({ message: 'Application not found.' });
  if (['approved', 'rejected'].includes(app.status)) {
    return res.status(409).json({ message: 'This application is already finalized.' });
  }
  if (app.status === 'needs_revision') {
    return res.status(409).json({ message: 'A revision was requested. Review opens again when the parent resubmits.' });
  }
  // A document that has been reviewed stays as decided until the parent uploads a new copy.
  const { rows: [current] } = await pool.query(
    `SELECT status FROM documents WHERE application_id = $1 AND doc_type = $2
     ORDER BY uploaded_at DESC, id DESC LIMIT 1`, [req.params.id, req.params.docType]
  );
  if (!current) return res.status(404).json({ message: 'Document not found.' });
  if (current.status !== 'pending') {
    return res.status(409).json({ message: 'This document was already reviewed. It opens again when the parent uploads a new copy.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE documents
       SET status = $1::text, review_note = $2,
           verified_by = CASE WHEN $1::text = 'pending' THEN NULL ELSE $3::bigint END,
           verified_at = CASE WHEN $1::text = 'pending' THEN NULL ELSE NOW() END
       WHERE id = (SELECT id FROM documents
                   WHERE application_id = $4 AND doc_type = $5
                   ORDER BY uploaded_at DESC, id DESC LIMIT 1)`,
      [status, status === 'verified' || status === 'pending' ? null : (note || null),
       req.user.id, req.params.id, req.params.docType]
    );
    if (!rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Document not found.' });
    }
    // The first review action moves a freshly submitted application into review.
    await client.query(
      `UPDATE enrollment_applications
       SET status = 'under_review', reviewed_by = $2
       WHERE id = $1 AND status IN ('submitted', 'resubmitted')`,
      [req.params.id, req.user.id]
    );
    await audit(client, req, 'DOCUMENT_' + status.toUpperCase(), req.params.id,
      { docType: req.params.docType, note: note || undefined });
    await client.query('COMMIT');
    res.json({ ok: true, status, note: status === 'verified' || status === 'pending' ? null : (note || null) });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// Streams the file a parent uploaded, to an authenticated reviewer only.
exports.documentFile = async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ message: 'Document not found.' });
  const { rows: [d] } = await pool.query(
    `SELECT id, file_path, mime_type FROM documents
     WHERE application_id = $1 AND doc_type = $2 AND file_path IS NOT NULL
     ORDER BY uploaded_at DESC, id DESC LIMIT 1`,
    [req.params.id, req.params.docType]
  );
  if (!d) return res.status(404).json({ message: 'No file has been uploaded for this document.' });

  // Only ever serve from the uploads folder, by file name alone, so a
  // bad path in the database cannot be used to read other files. The
  // stored path may be a Windows path, so split on both separators.
  const name = String(d.file_path).split(/[\\/]/).pop();
  const full = path.join(UPLOAD_DIR, name);
  if (!name || path.dirname(full) !== UPLOAD_DIR || !fs.existsSync(full)) {
    return res.status(404).json({
      message: 'The uploaded file could not be found on this server. It may have been uploaded to a different computer.',
    });
  }

  await audit(pool, req, 'DOCUMENT_VIEWED', req.params.id, { docType: req.params.docType }).catch(() => {});
  // Only PDFs and common images are shown inline. Any other file type
  // (Word, Excel, text, zip, ...) is handed over as a download so it can
  // never run in the browser. nosniff + sandbox stop content tricks.
  const SAFE_INLINE = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const inline = SAFE_INLINE.includes(d.mime_type);
  res.setHeader('Content-Type', inline ? d.mime_type : 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('X-Original-Type', d.mime_type || '');
  res.setHeader('Access-Control-Expose-Headers', 'X-Original-Type');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${req.params.docType}${path.extname(name).replace(/[^.\w]/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  fs.createReadStream(full).on('error', () => res.destroy()).pipe(res);
};

exports.setQualification = async (req, res) => {
  if (!['met', 'not_met'].includes((req.body || {}).value)) {
    return res.status(400).json({ message: 'Value must be met or not_met.' });
  }
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ message: 'Application not found.' });
  const { rowCount } = await pool.query(
    `UPDATE enrollment_applications
     SET grade_qualification = $1,
         status = CASE WHEN status IN ('submitted', 'resubmitted') THEN 'under_review' ELSE status END
     WHERE id = $2 AND status NOT IN ('approved', 'rejected', 'needs_revision')`,
    [req.body.value, req.params.id]
  );
  if (!rowCount) return res.status(409).json({ message: 'Application not found, already finalized, or waiting for the parent to resubmit.' });
  res.json({ ok: true });
};

exports.decide = async (req, res) => {
  const { action } = req.body || {};
  const remarks = (req.body && req.body.remarks) ?? '';
  const status = typeof action === 'string'
    ? { approve: 'approved', revision: 'needs_revision', reject: 'rejected' }[action]
    : undefined;
  if (!status) return res.status(400).json({ message: 'Unknown action.' });
  if (typeof remarks !== 'string') return res.status(400).json({ message: 'Remarks must be text.' });
  if (remarks.trim().length > REMARK_MAX) {
    return res.status(400).json({ message: `Remarks are too long (up to ${REMARK_MAX} characters).` });
  }
  if (!/^\d{1,9}$/.test(req.params.id)) return res.status(404).json({ message: 'Application not found.' });

  const { rows: [a] } = await pool.query(
    'SELECT status, grade_qualification FROM enrollment_applications WHERE id = $1',
    [req.params.id]
  );
  if (!a) return res.status(404).json({ message: 'Application not found.' });
  if (['approved', 'rejected'].includes(a.status)) {
    return res.status(409).json({ message: 'This application is already finalized.' });
  }
  if (a.status === 'needs_revision') {
    return res.status(409).json({ message: 'A revision was requested. Review opens again when the parent resubmits.' });
  }

  if (action === 'approve') {
    const { rows: latest } = await pool.query(LATEST_DOCS, [req.params.id]);
    const statusOf = Object.fromEntries(latest.map((d) => [d.doc_type, d.status]));
    const problems = latest.filter((d) => d.status === 'flagged' || d.status === 'rejected').map((d) => d.doc_type);
    if (problems.length) {
      return res.status(400).json({ message: `Before approving, resolve the flagged or rejected documents (${problems.join(', ')}).` });
    }
    const open = [
      ...CORE_DOCS.filter((c) => statusOf[c.type] !== 'verified').map((c) => c.name),
      ...latest
        .filter((d) => !CORE_DOCS.some((c) => c.type === d.doc_type) && d.status !== 'verified')
        .map((d) => d.doc_type),
    ];
    if (open.length || a.grade_qualification !== 'met') {
      const parts = [];
      if (open.length) parts.push(`verify every document (still open: ${open.join(', ')})`);
      if (a.grade_qualification !== 'met') parts.push('mark the grade qualification as Met');
      return res.status(400).json({ message: `Before approving, ${parts.join(' and ')}.` });
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

// ---------- Account settings ----------
exports.updateProfile = async (req, res) => {
  const { firstName, lastName, middleInitial } = req.body || {};
  if (!isValidName(firstName)) {
    return res.status(400).json({ message: 'First name is required and should contain letters only (up to 60 characters).' });
  }
  if (!isValidName(lastName)) {
    return res.status(400).json({ message: 'Last name is required and should contain letters only (up to 60 characters).' });
  }
  if (!isValidName(middleInitial, { required: false, max: MI_MAX })) {
    return res.status(400).json({ message: `M.I. should contain letters only (up to ${MI_MAX} characters).` });
  }
  const first = firstName.trim();
  const last = lastName.trim();
  const mi = typeof middleInitial === 'string' ? middleInitial.trim() : '';
  const { rows: [u] } = await pool.query(
    `UPDATE users
     SET first_name = $1, last_name = $2, middle_initial = NULLIF($3, ''),
         full_name = $4, updated_at = NOW()
     WHERE id = $5
     RETURNING id, email, first_name, last_name, middle_initial`,
    [first, last, mi, `${first} ${last}`, req.user.id]
  );
  res.json({
    id: u.id, email: u.email,
    firstName: u.first_name, lastName: u.last_name, middleName: u.middle_initial,
  });
};

exports.changePassword = async (req, res) => {
  const { current, next } = req.body || {};
  if (typeof current !== 'string' || !current) {
    return res.status(400).json({ message: 'Enter your current password.' });
  }
  const issues = passwordIssues(next);
  if (issues.length) {
    return res.status(400).json({ message: `New password needs ${issues.join(', ')}.` });
  }
  const { rows: [u] } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (Buffer.byteLength(current) > PASSWORD_MAX_BYTES || !(await bcrypt.compare(current, u.password_hash))) {
    return res.status(400).json({ message: 'Current password is incorrect.' });
  }
  if (await bcrypt.compare(next, u.password_hash)) {
    return res.status(400).json({ message: 'New password must be different from your current password.' });
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
  const lrn = typeof (req.body || {}).lrn === 'string' ? req.body.lrn.trim() : '';
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