const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const controller = require('../../controllers/admin/walkInEnrollmentController');
const { lrnLookupQuery, createWalkInEnrollment } = require('../../validators/walkInValidators');

const canCreate = [authenticate, requirePermission('application.create')];

router.get('/required-documents', ...canCreate, controller.requiredDocuments);
router.get('/lookup-by-lrn', ...canCreate, validate(lrnLookupQuery, 'query'), controller.lookupByLrn);
router.post('/', ...canCreate, validate(createWalkInEnrollment), controller.create);

module.exports = router;
