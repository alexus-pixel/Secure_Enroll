const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const schedulesController = require('../../controllers/admin/schedulesController');
const {
  createSubject, createScheduleEntry, updateScheduleEntry, conflictCheckQuery,
} = require('../../validators/scheduleValidators');

const canManage = [authenticate, requirePermission('schedule.manage')];

router.get('/grades', ...canManage, schedulesController.gradeSummary);
router.get('/grades/:gradeLevelId/sections', ...canManage, schedulesController.sectionsForGrade);
router.get('/grades/:gradeLevelId/subjects', ...canManage, schedulesController.subjectsForGrade);
router.get('/subjects', ...canManage, schedulesController.allSubjects);
router.post('/subjects', ...canManage, validate(createSubject), schedulesController.createSubject);
router.delete('/subjects/:id', ...canManage, schedulesController.deleteSubject);

router.get('/sections/:sectionId/entries', ...canManage, schedulesController.sectionSchedule);
router.get('/conflict-check', ...canManage, validate(conflictCheckQuery, 'query'), schedulesController.checkConflict);
router.post('/entries', ...canManage, validate(createScheduleEntry), schedulesController.createEntry);
router.patch('/entries/:id', ...canManage, validate(updateScheduleEntry), schedulesController.updateEntry);
router.delete('/entries/:id', ...canManage, schedulesController.deleteEntry);

router.get('/teachers/:teacherId/assignments', ...canManage, schedulesController.teacherAssignments);

module.exports = router;
