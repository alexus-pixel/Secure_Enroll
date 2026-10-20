const expressRateLimit = require('express-rate-limit');

// ---------------------------------------------------------------------
// Minimal in-memory, fixed-window limiter used by the parent/registrar
// routes (auth, students). Fine for a single-process deployment. A
// multi-instance production deployment would move this bucket into Redis
// or similar so limits are shared across processes.
// ---------------------------------------------------------------------
function rateLimit({ windowMs, max }) {
  // Each limiter keeps its OWN buckets. Previously every route shared one
  // bucket per IP, so a few harmless calls to one route (for example the
  // sign-up form's email check) used up the allowance of another route
  // (for example "resend verification email") and produced a 429.
  const buckets = new Map();

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now - bucket.start > windowMs) {
      buckets.set(key, { start: now, count: 1 });
      // Keep memory bounded: drop expired buckets once the map gets large.
      if (buckets.size > 5000) {
        for (const [k, b] of buckets) if (now - b.start > windowMs) buckets.delete(k);
      }
      return next();
    }
    if (bucket.count >= max) {
      // The page counts down to this, so "try again shortly" is a number.
      const seconds = Math.max(1, Math.ceil((bucket.start + windowMs - now) / 1000));
      res.set('Retry-After', String(seconds));
      return res.status(429).json({
        message: 'Too many requests. Please try again shortly.',
        retryAfter: seconds,
        lockedUntil: new Date(bucket.start + windowMs).toISOString(),
      });
    }
    bucket.count += 1;
    next();
  };
}

// ---------------------------------------------------------------------
// express-rate-limit based limiters used by the admin side.
// ---------------------------------------------------------------------

/**
 * Login already has DB-backed lockout (3 failed attempts -> 1 to 5
 * minutes, in authController.js). This adds a second, IP-based layer
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
  // The sign-in page counts down to the moment this lifts, so the reply
  // carries the time rather than "a few minutes".
  handler: (req, res, next, options) => {
    const resetAt = req.rateLimit && req.rateLimit.resetTime
      ? new Date(req.rateLimit.resetTime)
      : new Date(Date.now() + options.windowMs);
    const seconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    res.set('Retry-After', String(seconds));
    res.status(options.statusCode).json({
      message: 'Too many sign-in attempts from this device.',
      retryAfter: seconds,
      lockedUntil: resetAt.toISOString(),
    });
  },
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

/** Public landing-page data: cheap, cacheable, but still capped per IP. */
const publicApiLimiter = expressRateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
});

module.exports = { rateLimit, loginLimiter, adminApiLimiter, publicApiLimiter };