const express = require('express');
const router = express.Router();
const {
  register, login, getMe, updateProfile, changePassword, checkEmail,
} = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

router.post('/register', register);
router.post('/login', login);
router.get('/check-email', rateLimit({ windowMs: 60_000, max: 20 }), checkEmail);

// Every route below operates on the caller's own account (req.user.id),
// so authentication is enough — no RBAC permission check needed, a parent,
// registrar, or admin can all read and edit their own profile.
router.get('/me', authenticate, getMe);
router.patch('/me', authenticate, updateProfile);
router.put('/me/password', authenticate, changePassword);

module.exports = router;
