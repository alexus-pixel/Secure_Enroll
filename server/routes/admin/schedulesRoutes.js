const express = require('express');
const router = express.Router();
require('../../middleware/params').protectParams(router); // reject bad IDs with 400
const { authenticate, requirePermission } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const schedulesController = require('../../controllers/admin/schedulesController');
const {
  createSubject, updateSubject, setMaxSubjects,
  createScheduleEntry, updateScheduleEntry, conflictCheckQuery,
} = require('../../validators/scheduleValidators');

const canManage = [authenticate, requirePermission('schedule.manage')];

router.get('/school-years', ...canManage, schedulesController.scheduleSchoolYears);
router.get('/teachers', ...canManage, schedulesController.scheduleTeachers);
router.get('/grades', ...canManage, schedulesController.gradeSummary);
router.get('/grades/:gradeLevelId/sections', ...canManage, schedulesController.sectionsForGrade);
router.get('/grades/:gradeLevelId/subjects', ...canManage, schedulesController.subjectsForGrade);
// The subject panel's own read: subjects + per-grade limit + count.
router.get('/grades/:gradeLevelId/subject-settings', ...canManage, schedulesController.subjectSettings);
router.patch('/grades/:gradeLevelId/max-subjects', ...canManage, validate(setMaxSubjects), schedulesController.setMaxSubjects);
router.get('/subjects', ...canManage, schedulesController.allSubjects);
router.post('/subjects', ...canManage, validate(createSubject), schedulesController.createSubject);
router.patch('/subjects/:id', ...canManage, validate(updateSubject), schedulesController.updateSubject);
router.delete('/subjects/:id', ...canManage, schedulesController.deleteSubject);

router.get('/sections/:sectionId/entries', ...canManage, schedulesController.sectionSchedule);
// Who advises this section (sections.adviser_teacher_id). Read-only, and
// here rather than on the school-settings router so the registrar — who
// holds schedule.manage but not the settings permissions — can see it
// while viewing a schedule.
router.get('/sections/:sectionId/adviser', ...canManage, schedulesController.sectionAdviser);
router.get('/conflict-check', ...canManage, validate(conflictCheckQuery, 'query'), schedulesController.checkConflict);
router.post('/entries', ...canManage, validate(createScheduleEntry), schedulesController.createEntry);
router.patch('/entries/:id', ...canManage, validate(updateScheduleEntry), schedulesController.updateEntry);
router.delete('/entries/:id', ...canManage, schedulesController.deleteEntry);

router.get('/teachers/:teacherId/assignments', ...canManage, schedulesController.teacherAssignments);

module.exports = router;
