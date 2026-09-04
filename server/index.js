require('dotenv').config();
const express = require('express');
const authRoutes = require('./routes/authRoutes');
const cors = require('cors');
const applicationRoutes = require('./routes/applicationRoutes');
const pool = require('./db/pool');

const app = express();
app.use(cors());
app.use(express.json());

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
app.listen(PORT, () => console.log(`SecureEnroll API running on port ${PORT}`));