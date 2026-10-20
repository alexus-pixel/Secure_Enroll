const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Files live outside anything Express serves publicly.
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Only three file types are accepted: PDF, JPG and PNG. Anything else is
// refused here by its type and extension, and what actually arrives is then
// checked against the file's own first bytes (utils/fileSignature.js), because
// the type the browser reports is only a header and can be set to anything.
const ALLOWED_TYPES = new Map([
  ['application/pdf', ['.pdf']],
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['image/png', ['.png']],
]);
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
// What the file picker offers, and what the API documents.
const ACCEPT_ATTRIBUTE = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
const FILE_TYPE_MESSAGE = 'Only PDF, JPG and PNG files are accepted.';

function fileTypeProblem(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const type = String(file.mimetype || '').toLowerCase().split(';')[0].trim();
  if (!ALLOWED_EXTENSIONS.has(ext)) return FILE_TYPE_MESSAGE;
  if (!ALLOWED_TYPES.has(type)) return FILE_TYPE_MESSAGE;
  // The name and the type have to agree: "photo.png" sent as a PDF is refused
  // before it is ever written to disk.
  if (!ALLOWED_TYPES.get(type).includes(ext)) return FILE_TYPE_MESSAGE;
  return '';
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  // Never trust the original filename — a parent could upload "../../index.js".
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const problem = fileTypeProblem(file);
    if (problem) return cb(new Error(problem));
    cb(null, true);
  },
});

// Runs the upload and turns upload problems into clear 4xx replies. Without
// this, a wrong file type or a file over 5 MB reached the generic error
// handler and came back as "500 Something went wrong".
function uploadSingle(field) {
  const run = upload.single(field);
  return (req, res, next) => {
    run(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        const tooBig = err.code === 'LIMIT_FILE_SIZE';
        return res.status(tooBig ? 413 : 400).json({
          message: tooBig ? 'That file is too large. The limit is 5 MB.' : 'The file could not be uploaded.',
        });
      }
      return res.status(400).json({ message: err.message || 'The file could not be uploaded.' });
    });
  };
}

module.exports = {
  upload, uploadSingle, UPLOAD_DIR,
  ALLOWED_TYPES, ALLOWED_EXTENSIONS, ACCEPT_ATTRIBUTE, FILE_TYPE_MESSAGE, fileTypeProblem,
  // Kept so older callers that imported this name still work.
  NO_MEDIA_MESSAGE: FILE_TYPE_MESSAGE,
};