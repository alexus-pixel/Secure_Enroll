const pool = require('./pool');

// Ownership check: a parent must not be able to attach files to
// someone else's application just by changing the id in the URL.
async function applicationBelongsToGuardian(applicationId, guardianId) {
  const result = await pool.query(
    `SELECT 1 FROM enrollment_applications ea
     JOIN student_guardians sg ON sg.student_id = ea.student_id
     WHERE ea.id = $1 AND sg.guardian_id = $2`,
    [applicationId, guardianId]
  );
  return result.rows.length > 0;
}

async function createDocument({ applicationId, docType, filePath, mimeType, fileSize, checksum }) {
  const result = await pool.query(
    `INSERT INTO documents (application_id, doc_type, file_path, mime_type, file_size, checksum)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, doc_type, status, uploaded_at`,
    [applicationId, docType, filePath, mimeType, fileSize, checksum]
  );
  return result.rows[0];
}

async function getDocumentsForApplication(applicationId) {
  const result = await pool.query(
    `SELECT id, doc_type, status, uploaded_at FROM documents
     WHERE application_id = $1 ORDER BY uploaded_at`,
    [applicationId]
  );
  return result.rows;
}

module.exports = { applicationBelongsToGuardian, createDocument, getDocumentsForApplication };