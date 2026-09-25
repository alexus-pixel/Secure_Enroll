const express = require('express');
const router = express.Router();
const {
  register, login, getMe, updateProfile, changePassword,
} = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);

// Every route below operates on the caller's own account (req.user.id),
// so authentication is enough — no RBAC permission check needed, a parent,
// registrar, or admin can all read and edit their own profile.
router.get('/me', authenticate, getMe);
router.patch('/me', authenticate, updateProfile);
router.put('/me/password', authenticate, changePassword);

module.exports = router;
