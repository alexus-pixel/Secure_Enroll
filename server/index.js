require('dotenv').config();

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
const helmet = require('helmet');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const applicationRoutes = require('./routes/applicationRoutes');
const studentRoutes = require('./routes/studentRoutes');
const pool = require('./db/pool');

const app = express();

app.use(helmet());

// Only the app's own frontend may call this API cross-origin -- an open
// `cors()` (the previous setting) lets any website's JavaScript call it
// on a visitor's behalf using their bearer token, if one leaked.
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
app.use(cors({ origin: CLIENT_URL }));

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
app.use('/api/students', studentRoutes);

app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ message: err.message });
  next();
});

app.listen(PORT, () => console.log(`SecureEnroll API running on port ${PORT}`));
