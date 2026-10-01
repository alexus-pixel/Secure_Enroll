require('dotenv').config();
const express = require('express');
const authRoutes = require('./routes/authRoutes');
const applicationRoutes = require('./routes/applicationRoutes');
const adminRoutes = require('./routes/adminRoutes');
const pool = require('./db/pool');
const { securityHeaders, corsConfig } = require('./middleware/security');
const { adminApiLimiter } = require('./middleware/rateLimit');

const app = express();

// Fail loudly at startup, not on the first request, if a secret
// the whole app depends on was never set.
for (const name of ['JWT_SECRET', 'ENCRYPTION_KEY']) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}. Refusing to start.`);
    process.exit(1);
  }
}

app.use(securityHeaders());
app.use(corsConfig());
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
app.use('/api/admin', adminApiLimiter, adminRoutes);

app.use((err, req, res, next) => {
  if (err) {
    console.error(err);
    return res.status(err.status || 400).json({ message: err.message });
  }
  next();
});

app.listen(PORT, () => console.log(`SecureEnroll API running on port ${PORT}`));
