// Minimal in-memory, fixed-window rate limiter -- fine for a single-process
// school-project deployment. A multi-instance production deployment would
// move this bucket into Redis or similar so limits are shared across
// processes.
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

module.exports = { rateLimit };
