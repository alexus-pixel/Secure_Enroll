require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Fail fast on a missing secret rather than booting with a broken (or
// trivially guessable) JWT signature or encryption key -- either one
// silently makes the "secure" in SecureEnroll false.
for (const name of ['JWT_SECRET', 'ENCRYPTION_KEY']) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}. See server/.env.example.`);
    process.exit(1);
  }
}

const express = require('express');
const authRoutes = require('./routes/authRoutes');
const applicationRoutes = require('./routes/applicationRoutes');
const registrarRoutes = require('./routes/registrar');
const studentRoutes = require('./routes/studentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const pool = require('./db/pool');
const { securityHeaders, corsConfig } = require('./middleware/security');
const { adminApiLimiter } = require('./middleware/rateLimit');

const app = express();

// Security headers (helmet + CSP) and a CORS allow-list that only lets the
// app's own frontend call this API. See middleware/security.js.
app.use(securityHeaders());
app.use(corsConfig());

// A bound on request body size, so a huge JSON payload can't be used to
// exhaust memory before any of our own validation gets a chance to run.
app.use(express.json({ limit: '1mb' }));

// Health check: proves Express is running AND can reach Postgres
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', dbTime: result.rows[0].now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Database connection failed' });
  }
});

const PORT = process.env.PORT || 5000;
app.use('/api/auth', authRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/registrar', registrarRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/admin', adminApiLimiter, adminRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    message: status >= 500 ? 'Something went wrong on the server.' : err.message,
  });
});

app.listen(PORT, () => console.log(`SecureEnroll API running on port ${PORT}`));