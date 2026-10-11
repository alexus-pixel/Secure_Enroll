const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const dashboardController = require('../../controllers/admin/dashboardController');

router.get('/overview', authenticate, requirePermission('application.view_all'), dashboardController.overview);
router.get('/applications', authenticate, requirePermission('application.view_all'), dashboardController.applications);

module.exports = router;
