const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Files live outside anything Express serves publicly.
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];

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
    if (!ALLOWED.includes(file.mimetype)) {
      return cb(new Error('Only PDF, JPG, and PNG files are allowed.'));
    }
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

module.exports = { upload, uploadSingle, UPLOAD_DIR };