const express = require('express');
const router = express.Router();
const { lookup, addLrn } = require('../controllers/studentController');
const { authenticate, requirePermission } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

// Same permission as creating an application -- this lookup only exists to
// support the "returning student" enrollment flow, not as a general
// directory search.
router.get('/lookup', authenticate, requirePermission('application.create'),
  rateLimit({ windowMs: 60 * 1000, max: 20 }), lookup);

router.patch('/:id/lrn', authenticate, requirePermission('application.create'),
  rateLimit({ windowMs: 60 * 1000, max: 10 }), addLrn);

module.exports = router;
