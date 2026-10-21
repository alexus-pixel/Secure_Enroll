const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const controller = require('../../controllers/admin/walkInEnrollmentController');
const {
  lrnLookupQuery, createWalkInEnrollment, guardianLookupQuery, studentDuplicateQuery,
} = require('../../validators/walkInValidators');

// Walk-in enrollment is front-desk work: it creates a learner, creates or
// reuses a parent account, verifies documents and enrols the child on the
// spot. It therefore takes the permission that means "may review and decide
// on an enrollment", which only staff hold — NOT application.create, which is
// what a parent has in order to submit their own child's application. The
// lookups below answer questions about other families (who holds this Gmail,
// who holds this LRN) and sit behind the same gate for the same reason.
const canCreate = [authenticate, requirePermission('application.review')];

router.get('/required-documents', ...canCreate, controller.requiredDocuments);
router.get('/grade-levels', ...canCreate, controller.gradeLevels);
router.get('/sections', ...canCreate, controller.sections);
router.get('/lookup-by-lrn', ...canCreate, validate(lrnLookupQuery, 'query'), controller.lookupByLrn);
router.get('/guardian-lookup', ...canCreate, validate(guardianLookupQuery, 'query'), controller.guardianLookup);
router.get('/student-duplicate', ...canCreate, validate(studentDuplicateQuery, 'query'), controller.studentDuplicateCheck);
router.post('/', ...canCreate, validate(createWalkInEnrollment), controller.create);

module.exports = router;