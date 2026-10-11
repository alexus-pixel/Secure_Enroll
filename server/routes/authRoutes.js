const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/authController');
const { loginLimiter } = require('../middleware/rateLimit');

router.post('/register', register);
// The DB-backed lockout in authController.login (5 failed attempts
// -> 15 min) protects one account against a brute force targeted
// at it. This IP-based limiter is a second, independent layer: it
// slows down a script trying many different email addresses from
// one place, which the per-account lockout alone would not catch.
router.post('/login', loginLimiter, login);

const { authenticate } = require('../middleware/auth');

router.get('/me', authenticate, (req, res) => {
  res.json({ id: req.user.id, role: req.user.role });
});

module.exports = router;
