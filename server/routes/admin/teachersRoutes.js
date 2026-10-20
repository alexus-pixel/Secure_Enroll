const express = require('express');
const router = express.Router();
require('../../middleware/params').protectParams(router); // reject bad IDs with 400
const { authenticate, requirePermission } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const teachersController = require('../../controllers/admin/teachersController');
const {
  createTeacher, updateTeacher, checkEmailQuery, setTeacherActive, transferSchedule, handover,
} = require('../../validators/teacherValidators');

const canManage = [authenticate, requirePermission('teacher.manage')];

router.get('/', ...canManage, teachersController.list);
router.get('/degree-options', ...canManage, teachersController.degreeOptions);
router.get('/check-email', ...canManage, validate(checkEmailQuery, 'query'), teachersController.checkEmail);
router.get('/:id', ...canManage, teachersController.detail);
// What a hand-over away from this teacher is still waiting to give back.
router.get('/:id/pending-transfer', ...canManage, teachersController.pendingTransfer);
router.post('/', ...canManage, validate(createTeacher), teachersController.create);
router.patch('/:id', ...canManage, validate(updateTeacher), teachersController.update);
router.patch('/:id/active', ...canManage, validate(setTeacherActive), teachersController.setActive);
router.post('/:id/transfer-schedule', ...canManage, validate(transferSchedule), teachersController.transferSchedule);
// Deactivating a teacher means handing their work on: what has to move, and
// who may take each piece.
router.get('/:id/handover', ...canManage, teachersController.handoverPreview);
router.post('/:id/handover', ...canManage, validate(handover), teachersController.handover);
router.get('/:id/schedule', ...canManage, teachersController.schedule);
router.post('/:id/send-pdf', ...canManage, teachersController.sendPdf);

module.exports = router;
