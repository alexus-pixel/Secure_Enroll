const express = require('express');
const router = express.Router();
const { lookup } = require('../controllers/studentController');
const { authenticate, requirePermission } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

// Same permission as creating an application -- this lookup only exists to
// support the "returning student" enrollment flow, not as a general
// directory search.
router.get('/lookup', authenticate, requirePermission('application.create'),
  rateLimit({ windowMs: 60 * 1000, max: 20 }), lookup);

module.exports = router;
