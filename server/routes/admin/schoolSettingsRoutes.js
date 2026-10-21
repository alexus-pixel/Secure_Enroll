const express = require('express');
const router = express.Router();
require('../../middleware/params').protectParams(router); // reject bad IDs with 400
const { authenticate, requirePermission } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const schoolSettingsController = require('../../controllers/admin/schoolSettingsController');
const {
  createSchoolYear, createSection, updateSectionCapacity, updateSchoolYearDates, setSectionAdviser,
  updateSectionName, rolloverSchoolYear,
} = require('../../validators/settingsValidators');

const canManage = [authenticate, requirePermission('settings.manage')];

router.get('/', ...canManage, schoolSettingsController.overview);
router.post('/school-years', ...canManage, validate(createSchoolYear), schoolSettingsController.createSchoolYear);
router.patch('/school-years/:id/activate', ...canManage, schoolSettingsController.activateSchoolYear);
// Moves a school year's dates. The start date is only accepted while the year
// has not begun; the end date can always be changed.
router.patch('/school-years/:id/dates', ...canManage, validate(updateSchoolYearDates), schoolSettingsController.updateSchoolYearDates);
// The older path, kept so an open browser tab or a script that still posts to
// it keeps working. It reaches the same handler and obeys the same rules.
router.patch('/school-years/:id/end-date', ...canManage, validate(updateSchoolYearDates), schoolSettingsController.updateSchoolYearDates);
router.get('/teachers', ...canManage, schoolSettingsController.teacherOptions);
// Starts the following school year and copies the structure into it.
router.post('/school-years/:id/rollover', ...canManage, validate(rolloverSchoolYear), schoolSettingsController.rolloverSchoolYear);
router.post('/sections', ...canManage, validate(createSection), schoolSettingsController.createSection);
router.patch('/sections/:id/adviser', ...canManage, validate(setSectionAdviser), schoolSettingsController.setSectionAdviser);
router.patch('/sections/:id/capacity', ...canManage, validate(updateSectionCapacity), schoolSettingsController.updateSectionCapacity);
router.patch('/sections/:id/name', ...canManage, validate(updateSectionName), schoolSettingsController.updateSectionName);
// Who is actually enrolled in this section (name, sex, date approved).
router.get('/sections/:id/students', ...canManage, schoolSettingsController.sectionStudents);
router.delete('/sections/:id', ...canManage, schoolSettingsController.deleteSection);

module.exports = router;
