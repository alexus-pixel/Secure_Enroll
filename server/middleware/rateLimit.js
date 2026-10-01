const rateLimit = require('express-rate-limit');

/**
 * Login already has DB-backed lockout (5 failed attempts -> 15 min
 * lock, in authController.js). This adds a second, IP-based layer
 * in front of it: it stops one IP from hammering many different
 * email addresses (the DB lockout alone only slows down attempts
 * against a single known account) and it costs nothing extra to
 * apply. 10 attempts per 10 minutes per IP is generous for a real
 * user who mistypes a password a few times, punishing for a
 * credential-stuffing script.
 */
const loginLimiter = rateLimit({
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
const adminApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
});

module.exports = { loginLimiter, adminApiLimiter };
