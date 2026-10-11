const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const auditLogController = require('../../controllers/admin/auditLogController');

const canView = [authenticate, requirePermission('audit.view')];

router.get('/', ...canView, auditLogController.list);
router.get('/actions', ...canView, auditLogController.actions);
router.get('/export', ...canView, auditLogController.exportCsv);

module.exports = router;
