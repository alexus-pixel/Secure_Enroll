const helmet = require('helmet');
const cors = require('cors');

/**
 * helmet() with its defaults covers most of the OWASP-recommended
 * response headers on its own: X-Content-Type-Options: nosniff,
 * X-Frame-Options / frame-ancestors (clickjacking), a conservative
 * default Content-Security-Policy, and it turns off the
 * X-Powered-By header so the response doesn't advertise "Express"
 * to anyone probing the API.
 *
 * hsts is left on (it's a helmet default) since the school will be
 * running this behind HTTPS in production; it's a no-op over plain
 * HTTP in local dev.
 */
function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // The React build fetches its own JS/CSS bundle and talks to
        // this same API; it does not need any third-party script or
        // frame origins for the admin section.
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
}

/**
 * The existing app.use(cors()) with no options allows any origin,
 * which is fine for early local development but not for a system
 * that just authenticated a user and hands back a bearer token.
 * ALLOWED_ORIGIN should be set to the deployed client's real URL;
 * it falls back to the Vite dev server so `npm run dev` keeps
 * working with no extra setup.
 */
function corsConfig() {
  const allowed = (process.env.ALLOWED_ORIGIN || 'http://localhost:5173').split(',');
  return cors({
    origin: allowed,
    credentials: false, // the client sends the JWT in an Authorization header, not a cookie
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
}

module.exports = { securityHeaders, corsConfig };
