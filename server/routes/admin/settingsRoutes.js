const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const settingsController = require('../../controllers/admin/settingsController');
const {
  updateEnrollmentPeriod, updateRequiredDocuments,
  addRequiredDocument, updateRequiredDocument, documentIdParam,
} = require('../../validators/settingsValidators');

const canManage = [authenticate, requirePermission('settings.manage')];

router.get('/', ...canManage, settingsController.overview);
router.patch('/enrollment-period', ...canManage, validate(updateEnrollmentPeriod), settingsController.updateEnrollmentPeriod);
router.patch('/required-documents', ...canManage, validate(updateRequiredDocuments), settingsController.updateRequiredDocuments);
// The school decides what it asks for: a document type can be added, renamed,
// and removed while nothing has been filed under it.
router.post('/required-documents', ...canManage, validate(addRequiredDocument), settingsController.addRequiredDocument);
router.patch('/required-documents/:id', ...canManage, validate(documentIdParam, 'params'), validate(updateRequiredDocument), settingsController.updateRequiredDocument);
router.delete('/required-documents/:id', ...canManage, validate(documentIdParam, 'params'), settingsController.deleteRequiredDocument);

module.exports = router;
