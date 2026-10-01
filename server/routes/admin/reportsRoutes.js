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

module.exports = router;
