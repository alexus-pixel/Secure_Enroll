const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const teachersController = require('../../controllers/admin/teachersController');
const { createTeacher, updateTeacher, checkEmailQuery } = require('../../validators/teacherValidators');

const canManage = [authenticate, requirePermission('teacher.manage')];

router.get('/', ...canManage, teachersController.list);
router.get('/degree-options', ...canManage, teachersController.degreeOptions);
router.get('/check-email', ...canManage, validate(checkEmailQuery, 'query'), teachersController.checkEmail);
router.get('/:id', ...canManage, teachersController.detail);
router.post('/', ...canManage, validate(createTeacher), teachersController.create);
router.patch('/:id', ...canManage, validate(updateTeacher), teachersController.update);
router.get('/:id/schedule', ...canManage, teachersController.schedule);
router.post('/:id/send-pdf', ...canManage, teachersController.sendPdf);

module.exports = router;
