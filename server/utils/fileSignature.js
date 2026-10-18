const fs = require('fs');

// Multer's fileFilter only ever sees the Content-Type header the client
// sent -- trivial to fake (rename a script to "report.pdf" and set
// Content-Type: application/pdf by hand, e.g. with curl or Postman).
//
// Two checks live here, both on the file's real first bytes on disk:
//   1. matchesDeclaredType: a file that CLAIMS to be a PDF / JPG / PNG must
//      really be one.
//   2. looksLikeAudioOrVideo: the system accepts any file type except audio
//      and video, so those are recognised by their content too, not only by
//      the name or the type the browser reported.
const SIGNATURES = {
  'application/pdf': [Buffer.from('%PDF')],
  'image/jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])],
  'image/png': [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
};

function readHead(filePath, size = 16) {
  const buffer = Buffer.alloc(size);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, size, 0);
  } finally {
    fs.closeSync(fd);
  }
  return buffer;
}

function matchesDeclaredType(filePath, declaredMimeType) {
  const signatures = SIGNATURES[declaredMimeType];
  if (!signatures) return false;
  const buffer = readHead(filePath, 8);
  return signatures.some((sig) => buffer.subarray(0, sig.length).equals(sig));
}

const has = (buf, offset, text) => buf.subarray(offset, offset + text.length).toString('latin1') === text;

// ISO media "brands" used by video and audio files (mp4, mov, 3gp, m4a ...).
// Image formats that share the container (heic, avif) use other brands.
const MEDIA_BRANDS = new Set([
  'isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'mp71', 'avc1', 'dash', 'MSNV', 'M4V ', 'M4VH',
  'M4VP', 'M4A ', 'M4B ', 'M4P ', 'qt  ', '3gp4', '3gp5', '3gp6', '3gp7', '3g2a', '3g2b', '3g2c', 'f4v ',
]);

function looksLikeAudioOrVideo(filePath) {
  const b = readHead(filePath, 16);
  if (has(b, 4, 'ftyp') && MEDIA_BRANDS.has(b.subarray(8, 12).toString('latin1'))) return true; // mp4, mov, m4a, 3gp
  if (has(b, 0, 'RIFF') && (has(b, 8, 'AVI ') || has(b, 8, 'WAVE'))) return true; // avi, wav
  if (has(b, 0, 'ID3')) return true;                                              // mp3 with tag
  if (b[0] === 0xFF && (b[1] & 0xF6) === 0xF0) return true;                        // aac (ADTS)
  if (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0 && (b[1] & 0x06) !== 0) return true; // mp3 frame sync
  if (has(b, 0, 'OggS') || has(b, 0, 'fLaC')) return true;                         // ogg, flac
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return true; // mkv, webm
  if (has(b, 0, 'FLV')) return true;                                              // flv
  if (has(b, 0, 'MThd')) return true;                                             // midi
  if (has(b, 0, 'FORM') && (has(b, 8, 'AIFF') || has(b, 8, 'AIFC'))) return true; // aiff
  if (b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xB2 && b[3] === 0x75) return true; // wma / wmv (ASF)
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && (b[3] === 0xBA || b[3] === 0xB3)) return true; // mpeg
  return false;
}

module.exports = { matchesDeclaredType, looksLikeAudioOrVideo };
