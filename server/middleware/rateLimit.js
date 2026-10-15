const expressRateLimit = require('express-rate-limit');

// ---------------------------------------------------------------------
// Minimal in-memory, fixed-window limiter used by the parent/registrar
// routes (auth, students). Fine for a single-process deployment. A
// multi-instance production deployment would move this bucket into Redis
// or similar so limits are shared across processes.
// ---------------------------------------------------------------------
const buckets = new Map();

function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now - bucket.start > windowMs) {
      buckets.set(key, { start: now, count: 1 });
      return next();
    }
    if (bucket.count >= max) {
      return res.status(429).json({ message: 'Too many requests. Please try again shortly.' });
    }
    bucket.count += 1;
    next();
  };
}

// ---------------------------------------------------------------------
// express-rate-limit based limiters used by the admin side.
// ---------------------------------------------------------------------

/**
 * Login already has DB-backed lockout (5 failed attempts -> 15 min
 * lock, in authController.js). This adds a second, IP-based layer
 * in front of it: it stops one IP from hammering many different
 * email addresses (the DB lockout alone only slows down attempts
 * against a single known account). 10 attempts per 10 minutes per IP
 * is generous for a real user who mistypes a password a few times,
 * punishing for a credential-stuffing script.
 */
const loginLimiter = expressRateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please wait a few minutes and try again.' },
});

/**
 * A general ceiling on the admin API as a whole, per IP. This is
 * not meant to be tight enough to bother a real admin clicking
 * around; it exists so a leaked token or a scripting mistake can't
 * turn into an unbounded query flood against Postgres.
 */
const adminApiLimiter = expressRateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
});

module.exports = { rateLimit, loginLimiter, adminApiLimiter };