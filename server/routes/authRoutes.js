const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);

const { authenticate } = require('../middleware/auth');

router.get('/me', authenticate, (req, res) => {
  res.json({ id: req.user.id, role: req.user.role });
});

module.exports = router;