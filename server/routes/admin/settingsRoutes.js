const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const settingsController = require('../../controllers/admin/settingsController');
const { updateEnrollmentPeriod, updateRequiredDocuments } = require('../../validators/settingsValidators');

const canManage = [authenticate, requirePermission('settings.manage')];

router.get('/', ...canManage, settingsController.overview);
router.patch('/enrollment-period', ...canManage, validate(updateEnrollmentPeriod), settingsController.updateEnrollmentPeriod);
router.patch('/required-documents', ...canManage, validate(updateRequiredDocuments), settingsController.updateRequiredDocuments);

module.exports = router;
