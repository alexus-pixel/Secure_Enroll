const express = require('express');
const router = express.Router();

// ASSUMPTION: your RBAC middleware lives at ../middleware/auth and exports
// authenticate + requirePermission, matching what's documented for the
// project. Adjust this import path if it's actually named/located
// differently in your repo.
const { authenticate, requirePermission } = require('../middleware/auth');

const adminUsers = require('../db/adminUsers');
const auditLogs = require('../db/auditLogs');
const schoolSettings = require('../db/schoolSettings');

// Every route below requires a valid login first.
router.use(authenticate);

// ASSUMPTION: the permission strings below ('admin:manage_users', etc.) are
// placeholders. Check your permissions table / seed data for the actual
// strings requirePermission expects, and swap these to match — getting
// this wrong either locks admins out or, worse, lets the wrong role in.

// ---- Users ----

router.get('/users', requirePermission('user.manage'), async (req, res, next) => {
  try {
    const { role, search, page, limit } = req.query;
    const result = await adminUsers.getAllUsers({
      role,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/roles', requirePermission('user.manage'), async (req, res, next) => {
  try {
    res.json(await adminUsers.getRoles());
  } catch (err) {
    next(err);
  }
});

router.post('/users', requirePermission('user.manage'), async (req, res, next) => {
  try {
    const { email, password, fullName, roleId } = req.body;
    if (!email || !password || !fullName || !roleId) {
      return res.status(400).json({ error: 'email, password, fullName, and roleId are required' });
    }
    const user = await adminUsers.createStaffUser({ email, password, fullName, roleId });
    await auditLogs.recordAuditLog({
      userId: req.user.id,
      action: 'ADMIN_CREATE_USER',
      details: { createdUserId: user.id, email },
      ipAddress: req.ip,
    });
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:id/role', requirePermission('user.manage'), async (req, res, next) => {
  try {
    const { roleId } = req.body;
    const updated = await adminUsers.updateUserRole(req.params.id, roleId);
    await auditLogs.recordAuditLog({
      userId: req.user.id,
      action: 'ADMIN_CHANGE_ROLE',
      details: { targetUserId: req.params.id, roleId },
      ipAddress: req.ip,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:id/status', requirePermission('user.manage'), async (req, res, next) => {
  try {
    const { isActive } = req.body;
    const updated = await adminUsers.setUserActive(req.params.id, isActive);
    await auditLogs.recordAuditLog({
      userId: req.user.id,
      action: isActive ? 'ADMIN_ACTIVATE_USER' : 'ADMIN_DEACTIVATE_USER',
      details: { targetUserId: req.params.id },
      ipAddress: req.ip,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ---- Audit Log ----

router.get('/audit-logs', requirePermission('audit.view'), async (req, res, next) => {
  try {
    const { userId, action, startDate, endDate, page, limit } = req.query;
    const result = await auditLogs.getAuditLogs({
      userId,
      action,
      startDate,
      endDate,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---- School Settings ----

router.get('/school-years', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    res.json(await schoolSettings.getSchoolYears());
  } catch (err) {
    next(err);
  }
});

router.post('/school-years', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const created = await schoolSettings.createSchoolYear(req.body);
    await auditLogs.recordAuditLog({
      userId: req.user.id,
      action: 'ADMIN_CREATE_SCHOOL_YEAR',
      details: created,
      ipAddress: req.ip,
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.patch('/school-years/:id/activate', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const updated = await schoolSettings.setActiveSchoolYear(req.params.id);
    await auditLogs.recordAuditLog({
      userId: req.user.id,
      action: 'ADMIN_SET_ACTIVE_SCHOOL_YEAR',
      details: { schoolYearId: req.params.id },
      ipAddress: req.ip,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.get('/grade-levels', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    res.json(await schoolSettings.getGradeLevels());
  } catch (err) {
    next(err);
  }
});

router.post('/grade-levels', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    res.status(201).json(await schoolSettings.createGradeLevel(req.body));
  } catch (err) {
    next(err);
  }
});

router.get('/sections', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    res.json(await schoolSettings.getSections(req.query.gradeLevelId));
  } catch (err) {
    next(err);
  }
});

router.post('/sections', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    res.status(201).json(await schoolSettings.createSection(req.body));
  } catch (err) {
    next(err);
  }
});

router.patch('/sections/:id', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    res.json(await schoolSettings.updateSection(req.params.id, req.body));
  } catch (err) {
    next(err);
  }
});

module.exports = router;