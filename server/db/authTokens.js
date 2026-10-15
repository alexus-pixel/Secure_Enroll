const crypto = require('crypto');
const pool = require('./pool');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Issues a token, returning the raw value once -- the only moment it ever
// exists outside this function -- so the caller can drop it into an email
// link. Only its hash is persisted. Any earlier unused token for the same
// user + purpose is invalidated first, so at most one link is ever live
// at a time (clicking an old "verify your email" link after requesting a
// new one correctly fails).
async function issueToken(userId, purpose, ttlMs) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + ttlMs);

  await pool.query(
    `UPDATE auth_tokens SET used_at = NOW()
     WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
    [userId, purpose]
  );
  await pool.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, purpose, tokenHash, expiresAt]
  );
  return token;
}

// Returns the token row if it exists, is unused, and hasn't expired --
// otherwise null. Does not mark it used; call consumeToken once the
// caller has actually acted on it, so a failure partway through an
// action doesn't silently burn the user's only link.
async function findValidToken(rawToken, purpose) {
  if (!rawToken) return null;
  const tokenHash = sha256(rawToken);
  const result = await pool.query(
    `SELECT id, user_id FROM auth_tokens
     WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > NOW()`,
    [tokenHash, purpose]
  );
  return result.rows[0] || null;
}

async function consumeToken(id) {
  await pool.query(`UPDATE auth_tokens SET used_at = NOW() WHERE id = $1`, [id]);
}

// Unlike findValidToken, this returns the row even if it's already been
// used or has expired -- used only to explain WHY a token isn't valid
// (e.g. distinguishing "you already verified" from "this link is dead"),
// never to grant anything on its own.
async function findTokenRecord(rawToken, purpose) {
  if (!rawToken) return null;
  const tokenHash = sha256(rawToken);
  const result = await pool.query(
    `SELECT id, user_id, used_at, expires_at FROM auth_tokens WHERE token_hash = $1 AND purpose = $2`,
    [tokenHash, purpose]
  );
  return result.rows[0] || null;
}

module.exports = { issueToken, findValidToken, findTokenRecord, consumeToken };
