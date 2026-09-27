const fs = require('fs');

// Multer's fileFilter only ever sees the Content-Type header the client
// sent -- trivial to fake (rename a script to "report.pdf" and set
// Content-Type: application/pdf by hand, e.g. with curl or Postman).
// This checks the file's real first bytes on disk against the actual
// magic number for each allowed type, so a mislabeled file is caught
// AFTER upload, before it's ever trusted or handed to a registrar to open.
const SIGNATURES = {
  'application/pdf': [Buffer.from('%PDF')],
  'image/jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])],
  'image/png': [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
};

function matchesDeclaredType(filePath, declaredMimeType) {
  const signatures = SIGNATURES[declaredMimeType];
  if (!signatures) return false;

  const buffer = Buffer.alloc(8);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, 8, 0);
  fs.closeSync(fd);

  return signatures.some((sig) => buffer.subarray(0, sig.length).equals(sig));
}

module.exports = { matchesDeclaredType };
