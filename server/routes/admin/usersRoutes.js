const express = require('express');
const router = express.Router();
require('../../middleware/params').protectParams(router); // reject bad IDs with 400
const { authenticate, requirePermission } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const usersController = require('../../controllers/admin/usersController');
const { createStaffUser, setUserActive, listUsersQuery } = require('../../validators/userValidators');

const canManage = [authenticate, requirePermission('user.manage')];

router.get('/', ...canManage, validate(listUsersQuery, 'query'), usersController.list);
router.get('/counts', ...canManage, usersController.counts);
// Is this address already somebody's account? Asked while it is typed.
router.get('/check-email', ...canManage, usersController.checkEmail);
router.get('/roles', ...canManage, usersController.roles);
router.post('/', ...canManage, validate(createStaffUser), usersController.create);
// Changing someone else's role and resetting someone else's password are
// deliberately not offered: an administrator cannot do either. An account
// that forgets its password uses "Forgot password" like everyone else.
router.patch('/:id/active', ...canManage, validate(setUserActive), usersController.setActive);

module.exports = router;
