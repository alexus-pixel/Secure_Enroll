const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const reportsController = require('../../controllers/admin/reportsController');

const canView = [authenticate, requirePermission('application.view_all')];

router.get('/master-enrollment-list', ...canView, reportsController.masterEnrollmentList);
router.get('/application-status', ...canView, reportsController.applicationStatusReport);
router.get('/pending-applications', ...canView, reportsController.pendingApplications);
router.get('/registrar-activity', ...canView, reportsController.registrarActivityReport);
router.get('/duplicate-flags', ...canView, reportsController.duplicateFlagsReport);
router.get('/grade-level-capacity', ...canView, reportsController.gradeLevelCapacityReport);

// Master list emails: each section's list goes to its adviser when enrollment closes.
const masterListEmail = require('../../controllers/admin/masterListEmailController');
const canSend = [authenticate, requirePermission('teacher.manage')];
router.get('/master-list-emails', ...canView, masterListEmail.overview);
router.post('/master-list-emails/send', ...canSend, masterListEmail.send);
router.patch('/master-list-emails/auto', ...canSend, masterListEmail.setAuto);

module.exports = router;
