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

module.exports = { upload, UPLOAD_DIR };