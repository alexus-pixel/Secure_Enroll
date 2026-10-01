const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const schoolSettingsController = require('../../controllers/admin/schoolSettingsController');
const { createSchoolYear, createSection, updateSectionCapacity, updateSchoolYearEndDate } = require('../../validators/settingsValidators');

const canManage = [authenticate, requirePermission('settings.manage')];

router.get('/', ...canManage, schoolSettingsController.overview);
router.post('/school-years', ...canManage, validate(createSchoolYear), schoolSettingsController.createSchoolYear);
router.patch('/school-years/:id/activate', ...canManage, schoolSettingsController.activateSchoolYear);
router.patch('/school-years/:id/end-date', ...canManage, validate(updateSchoolYearEndDate), schoolSettingsController.updateSchoolYearEndDate);
router.post('/sections', ...canManage, validate(createSection), schoolSettingsController.createSection);
router.patch('/sections/:id/capacity', ...canManage, validate(updateSectionCapacity), schoolSettingsController.updateSectionCapacity);
router.delete('/sections/:id', ...canManage, schoolSettingsController.deleteSection);

module.exports = router;
