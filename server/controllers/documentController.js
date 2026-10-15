const fs = require('fs');
const crypto = require('crypto');
const pool = require('../db/pool');
const {
  applicationBelongsToGuardian, createDocument, getDocumentsForApplication,
} = require('../db/documents');
const { matchesDeclaredType } = require('../utils/fileSignature');

const VALID_DOC_TYPES = ['birth_certificate', 'form_138', 'good_moral'];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function uploadDocument(req, res) {
  try {
    const applicationId = req.params.id;
    const { docType } = req.body;

    if (!req.file) return res.status(400).json({ message: 'No file received.' });
    if (!VALID_DOC_TYPES.includes(docType)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Unrecognized document type.' });
    }

    if (!(await applicationBelongsToGuardian(applicationId, req.user.id))) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ message: 'This application is not yours.' });
    }

    // A document the registrar has already verified is final.
    const latest = await pool.query(
      `SELECT status FROM documents WHERE application_id = $1 AND doc_type = $2
       ORDER BY uploaded_at DESC, id DESC LIMIT 1`,
      [applicationId, docType]
    );
    if (latest.rows[0]?.status === 'verified') {
      fs.unlinkSync(req.file.path);
      return res.status(409).json({ message: 'That document has already been verified.' });
    }

    if (!matchesDeclaredType(req.file.path, req.file.mimetype)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'That file does not appear to be a valid PDF, JPG, or PNG.' });
    }

    const doc = await createDocument({
      applicationId,
      docType,
      filePath: req.file.path,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      checksum: sha256(req.file.path),
    });

    // A replacement for a flagged or rejected document sends a returned
    // application back to the registrar's queue.
    await pool.query(
      `UPDATE enrollment_applications SET status = 'submitted'
       WHERE id = $1 AND status = 'needs_revision'`,
      [applicationId]
    );

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, user_agent)
       VALUES ($1, 'DOCUMENT_UPLOADED', 'document', $2, $3, $4)`,
      [req.user.id, doc.id, req.ip, req.get('user-agent')]
    );

    res.status(201).json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Upload failed.' });
  }
}

async function listDocuments(req, res) {
  try {
    if (!(await applicationBelongsToGuardian(req.params.id, req.user.id))) {
      return res.status(403).json({ message: 'This application is not yours.' });
    }
    res.json(await getDocumentsForApplication(req.params.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load documents.' });
  }
}

module.exports = { uploadDocument, listDocuments };