const express = require('express');
const router = express.Router();
require('../middleware/params').protectParams(router); // reject bad IDs with 400
const { authenticate, requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/registrarController');
// Walk-in enrollment is one implementation shared with the admin side:
// it requires the parent's Gmail and creates (or reuses) their account.
const walkIn = require('../controllers/admin/walkInEnrollmentController');
const {
  lrnLookupQuery, createWalkInEnrollment, guardianLookupQuery, studentDuplicateQuery,
} = require('../validators/walkInValidators');

// Express 4 does not catch rejected promises from async handlers.
// This forwards errors to the error middleware in index.js instead of crashing.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// TODO: replace with real codes from the DB: SELECT code FROM permissions ORDER BY code;
const CAN_REVIEW = 'application.review';
const CAN_WALK_IN = 'application.review';

router.use(authenticate);

// ---------- Account settings (staff only) ----------
// A parent has their own /auth/me, which also keeps their guardian record in
// step; this one writes the staff name on the users row alone.
// Staff only: a parent reaching this would change the name on their account
// while the guardian record every master list reads stayed as it was.
const isStaff = (req, res, next) => (
  req.user?.role === 'registrar' || req.user?.role === 'admin'
    ? next()
    : res.status(403).json({ message: 'This is a staff page. Your own profile is under Edit Profile.' })
);
router.patch('/profile', isStaff, wrap(c.updateProfile));
router.post('/password', isStaff, wrap(c.changePassword));

// ---------- Dashboard + application review ----------
router.get('/applications', requirePermission(CAN_REVIEW), wrap(c.list));
router.get('/applications/:id', requirePermission(CAN_REVIEW), wrap(c.get));
router.get('/applications/:id/documents/:docType/file', requirePermission(CAN_REVIEW), wrap(c.documentFile));
router.patch('/applications/:id/documents/:docType', requirePermission(CAN_REVIEW), wrap(c.setDocumentStatus));
router.patch('/applications/:id/qualification', requirePermission(CAN_REVIEW), wrap(c.setQualification));
router.post('/applications/:id/decision', requirePermission(CAN_REVIEW), wrap(c.decide));
router.get('/applications/:id/sections', requirePermission(CAN_REVIEW), wrap(c.sectionOptions));
router.post('/applications/:id/section', requirePermission(CAN_REVIEW), wrap(c.assignSection));

// ---------- Walk-in ----------
router.get('/walk-in-enrollment/required-documents', requirePermission(CAN_WALK_IN), wrap(walkIn.requiredDocuments));
router.get('/walk-in-enrollment/grade-levels', requirePermission(CAN_WALK_IN), wrap(walkIn.gradeLevels));
router.get('/walk-in-enrollment/sections', requirePermission(CAN_WALK_IN), wrap(walkIn.sections));
router.get('/walk-in-enrollment/lookup-by-lrn', requirePermission(CAN_WALK_IN), validate(lrnLookupQuery, 'query'), wrap(walkIn.lookupByLrn));
router.get('/walk-in-enrollment/guardian-lookup', requirePermission(CAN_WALK_IN), validate(guardianLookupQuery, 'query'), wrap(walkIn.guardianLookup));
router.get('/walk-in-enrollment/student-duplicate', requirePermission(CAN_WALK_IN), validate(studentDuplicateQuery, 'query'), wrap(walkIn.studentDuplicateCheck));
router.post('/walk-in-enrollment', requirePermission(CAN_WALK_IN), validate(createWalkInEnrollment), wrap(walkIn.create));

// ---------- Missing LRN ----------
router.get('/students/missing-lrn', requirePermission('student.view_all'), wrap(c.listMissingLrn));
router.patch('/students/:studentId/lrn', requirePermission(CAN_REVIEW), wrap(c.setLrn));
router.post('/students/:studentId/lrn-flag', requirePermission(CAN_REVIEW), wrap(c.flagLrn));

module.exports = router;