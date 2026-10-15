const express = require('express');
const router = express.Router();
require('../middleware/params').protectParams(router); // reject bad IDs with 400
const { authenticate, requirePermission, requireVerifiedEmail } = require('../middleware/auth');
const { submit, promote, mine, detail } = require('../controllers/applicationController');


router.post('/', authenticate, requireVerifiedEmail, requirePermission('application.create'), submit);
router.post('/promote', authenticate, requireVerifiedEmail, requirePermission('application.create'), promote);
router.get('/mine', authenticate, requirePermission('application.view_own'), mine);
router.get('/:id', authenticate, requirePermission('application.view_own'), detail);

const { uploadSingle } = require('../middleware/upload');
const { uploadDocument, listDocuments } = require('../controllers/documentController');

router.post('/:id/documents', authenticate, requirePermission('document.upload'), uploadSingle('file'), uploadDocument);
router.get('/:id/documents', authenticate, requirePermission('application.view_own'), listDocuments);

module.exports = router;