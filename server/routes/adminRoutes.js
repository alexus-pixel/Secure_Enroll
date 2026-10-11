const express = require('express');
const router = express.Router();

router.use('/dashboard', require('./admin/dashboardRoutes'));
router.use('/users', require('./admin/usersRoutes'));
router.use('/teachers', require('./admin/teachersRoutes'));
router.use('/schedules', require('./admin/schedulesRoutes'));
router.use('/audit-logs', require('./admin/auditLogRoutes'));
router.use('/settings', require('./admin/settingsRoutes'));
router.use('/school-settings', require('./admin/schoolSettingsRoutes'));
router.use('/reports', require('./admin/reportsRoutes'));
router.use('/walk-in-enrollment', require('./admin/walkInEnrollmentRoutes'));

module.exports = router;