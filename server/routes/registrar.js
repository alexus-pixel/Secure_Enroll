const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../middleware/auth');
const c = require('../controllers/registrarController');

// Express 4 does not catch rejected promises from async handlers.
// This forwards errors to the error middleware in index.js instead of crashing.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// TODO: replace with real codes from the DB: SELECT code FROM permissions ORDER BY code;
const CAN_REVIEW = 'application.review';
const CAN_WALK_IN = 'application.review';

router.use(authenticate);

// ---------- Account settings (any logged-in user) ----------
router.patch('/profile', wrap(c.updateProfile));
router.post('/password', wrap(c.changePassword));

// ---------- Dashboard + application review ----------
router.get('/applications', requirePermission(CAN_REVIEW), wrap(c.list));
router.get('/applications/:id', requirePermission(CAN_REVIEW), wrap(c.get));
router.patch('/applications/:id/documents/:docType', requirePermission(CAN_REVIEW), wrap(c.setDocumentStatus));
router.patch('/applications/:id/qualification', requirePermission(CAN_REVIEW), wrap(c.setQualification));
router.post('/applications/:id/decision', requirePermission(CAN_REVIEW), wrap(c.decide));

// ---------- Walk-in ----------
router.post('/walk-in', requirePermission(CAN_WALK_IN), wrap(c.walkIn));
router.get('/learners/:lrn', requirePermission(CAN_WALK_IN), wrap(c.lookupLearner));
router.post('/learners/:studentId/promote', requirePermission(CAN_WALK_IN), wrap(c.promote));

module.exports = router;