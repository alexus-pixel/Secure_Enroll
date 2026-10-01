const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const usersController = require('../../controllers/admin/usersController');
const {
  createStaffUser, updateUserRole, setUserActive, resetPassword, listUsersQuery,
} = require('../../validators/userValidators');

const canManage = [authenticate, requirePermission('user.manage')];

router.get('/', ...canManage, validate(listUsersQuery, 'query'), usersController.list);
router.get('/counts', ...canManage, usersController.counts);
router.get('/roles', ...canManage, usersController.roles);
router.post('/', ...canManage, validate(createStaffUser), usersController.create);
router.patch('/:id/role', ...canManage, validate(updateUserRole), usersController.updateRole);
router.patch('/:id/active', ...canManage, validate(setUserActive), usersController.setActive);
router.post('/:id/reset-password', ...canManage, validate(resetPassword), usersController.resetPassword);

module.exports = router;
