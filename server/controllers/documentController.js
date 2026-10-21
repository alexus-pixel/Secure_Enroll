const fs = require('fs');
const crypto = require('crypto');
const pool = require('../db/pool');
const {
  applicationBelongsToGuardian, createDocument, getDocumentsForApplication,
} = require('../db/documents');
const { matchesDeclaredType, looksLikeAudioOrVideo } = require('../utils/fileSignature');
const { FILE_TYPE_MESSAGE, fileTypeProblem } = require('../middleware/upload');

const { getRequiredDocumentTypes } = require('../lib/documentTypes');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function uploadDocument(req, res) {
  try {
    const applicationId = req.params.id;
    const { docType } = req.body;

    if (!req.file) return res.status(400).json({ message: 'No file received.' });
    // Only documents checked in System Settings can be uploaded. (A file that is
    // already on this application can still be replaced if the setting changed later.)
    const validTypes = (await getRequiredDocumentTypes()).map((t) => t.code);
    const alreadyOnFile = validTypes.includes(docType) ? null : await pool.query(
      'SELECT 1 FROM documents WHERE application_id = $1 AND doc_type = $2 LIMIT 1', [applicationId, docType]
    ).catch(() => null);
    if (!validTypes.includes(docType) && !alreadyOnFile?.rowCount) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'That document is not requested by the school.' });
    }

    if (!(await applicationBelongsToGuardian(applicationId, req.user.id))) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ message: 'This application is not yours.' });
    }

    // Nothing can be uploaded once the school has made its final decision.
    const appRow = await pool.query('SELECT status FROM enrollment_applications WHERE id = $1', [applicationId]);
    if (['approved', 'rejected'].includes(appRow.rows[0]?.status)) {
      fs.unlinkSync(req.file.path);
      return res.status(409).json({ message: 'This application is already finalized.' });
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

    // Only PDF, JPG and PNG are accepted. The upload middleware refuses
    // anything else by name and declared type; here the file is on disk, so
    // its real first bytes decide. A renamed script, a video with a .pdf
    // name, or a PNG sent as a PDF all stop here and the file is deleted.
    if (fileTypeProblem(req.file) || !matchesDeclaredType(req.file.path, String(req.file.mimetype || '').toLowerCase())) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        message: `${FILE_TYPE_MESSAGE} This file is not a real ${req.file.mimetype === 'application/pdf' ? 'PDF' : 'image'}, or its name and contents do not match.`,
      });
    }
    if (looksLikeAudioOrVideo(req.file.path)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: FILE_TYPE_MESSAGE });
    }

    const doc = await createDocument({
      applicationId,
      docType,
      filePath: req.file.path,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      checksum: sha256(req.file.path),
    });

    // A replacement for a flagged or rejected document (or an answer to a
    // revision request) puts the application back in the registrar's queue,
    // marked 'resubmitted' so it stands out from first-time submissions.
    const replacedProblem = ['flagged', 'rejected'].includes(latest.rows[0]?.status);
    await pool.query(
      `UPDATE enrollment_applications SET status = 'resubmitted'
       WHERE id = $1 AND (status = 'needs_revision' OR ($2::boolean AND status IN ('submitted', 'under_review')))`,
      [applicationId, replacedProblem]
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