const express = require('express');
const router = express.Router();
const {
  register, login, getMe, updateProfile, changePassword, checkEmail,
  verifyEmail, resendVerification, forgotPassword, resetPassword,
} = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

// Public, unauthenticated endpoints. Each gets its own rate limit sized to
// what a real user would ever legitimately need in that window -- tight
// enough to blunt automated abuse, loose enough that nobody locks
// themselves out by mistyping a password a few times.
router.post('/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 8 }), register);
router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 15 }), login);
router.get('/check-email', rateLimit({ windowMs: 60 * 1000, max: 20 }), checkEmail);
router.get('/verify-email', rateLimit({ windowMs: 60 * 1000, max: 10 }), verifyEmail);
router.post('/forgot-password', rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }), forgotPassword);
router.post('/reset-password', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), resetPassword);

// Every route below operates on the caller's own account (req.user.id),
// so authentication is enough -- no RBAC permission check needed, a parent,
// registrar, or admin can all read and edit their own profile.
router.get('/me', authenticate, getMe);
router.patch('/me', authenticate, updateProfile);
router.put('/me/password', authenticate, changePassword);
router.post('/resend-verification', authenticate, rateLimit({ windowMs: 5 * 60 * 1000, max: 3 }), resendVerification);

module.exports = router;
