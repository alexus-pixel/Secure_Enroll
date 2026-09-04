const fs = require('fs');
const crypto = require('crypto');
const pool = require('../db/pool');
const {
  applicationBelongsToGuardian, createDocument, getDocumentsForApplication,
} = require('../db/documents');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function uploadDocument(req, res) {
  try {
    const applicationId = req.params.id;
    const { docType } = req.body;

    if (!req.file) return res.status(400).json({ message: 'No file received.' });
    if (!docType) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Document type is required.' });
    }

    if (!(await applicationBelongsToGuardian(applicationId, req.user.id))) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ message: 'This application is not yours.' });
    }

    const doc = await createDocument({
      applicationId,
      docType,
      filePath: req.file.path,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      checksum: sha256(req.file.path),
    });

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