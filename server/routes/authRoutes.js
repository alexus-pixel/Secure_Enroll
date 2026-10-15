const express = require('express');
const router = express.Router();
const {
  register, login, getMe, updateProfile, changePassword, checkEmail,
  verifyEmail, resendVerification, resendVerificationByTicket, verificationStatus,
  forgotPassword, resetPassword,
} = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { rateLimit, loginLimiter } = require('../middleware/rateLimit');

// Public, unauthenticated endpoints. Each gets its own rate limit sized to
// what a real user would ever legitimately need in that window -- tight
// enough to blunt automated abuse, loose enough that nobody locks
// themselves out by mistyping a password a few times.
router.post('/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 8 }), register);
// The DB-backed lockout in authController.login (5 failed attempts
// -> 15 min) protects one account against a brute force targeted
// at it. This IP-based limiter is a second, independent layer: it
// slows down a script trying many different email addresses from
// one place, which the per-account lockout alone would not catch.
router.post('/login', loginLimiter, login);
router.get('/check-email', rateLimit({ windowMs: 60 * 1000, max: 20 }), checkEmail);
router.get('/verify-email', rateLimit({ windowMs: 60 * 1000, max: 10 }), verifyEmail);
// Used by the "Verifying email" screen for someone who cannot sign in yet.
// Both are authorised by the short-lived ticket in the request body.
router.post('/verification-status', rateLimit({ windowMs: 60 * 1000, max: 60 }), verificationStatus);
router.post('/verification-resend', rateLimit({ windowMs: 10 * 60 * 1000, max: 10 }), resendVerificationByTicket);
router.post('/forgot-password', rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }), forgotPassword);
router.post('/reset-password', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), resetPassword);

// Every route below operates on the caller's own account (req.user.id),
// so authentication is enough -- no RBAC permission check needed, a parent,
// registrar, or admin can all read and edit their own profile.
router.get('/me', authenticate, getMe);
router.patch('/me', authenticate, updateProfile);
router.put('/me/password', authenticate, changePassword);
router.post('/resend-verification', authenticate, rateLimit({ windowMs: 5 * 60 * 1000, max: 10 }), resendVerification);

module.exports = router;