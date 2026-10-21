const {
  findReturningStudentForGuardian, getDocumentsOnFileForStudent, guardianOwnsStudent, addLrnIfMissing,
  findStudentByFullName, duplicateNameMessage, activeYearEnrollment, alreadyEnrolledMessage,
} = require('../db/students');

const { getRequiredDocumentTypes } = require('../lib/documentTypes');

async function lookup(req, res) {
  try {
    const lrn = (req.query.lrn || '').toString().trim();
    if (!lrn) {
      return res.status(400).json({ message: 'Enter an LRN to search.' });
    }
    if (!/^\d{12}$/.test(lrn)) {
      return res.status(400).json({ message: 'LRN should be exactly 12 digits.' });
    }

    const student = await findReturningStudentForGuardian(lrn, req.user.id);
    if (!student) {
      return res.json({ found: false });
    }

    // Already enrolled for the year enrollment is running for: there is
    // nothing to apply for, so the form is not offered.
    const current = await activeYearEnrollment(student.id);
    if (current) {
      return res.json({
        found: true,
        promotable: false,
        alreadyEnrolled: true,
        message: alreadyEnrolledMessage(current, student.first_name),
      });
    }

    if (!student.next_grade_level_id) {
      return res.json({
        found: true,
        promotable: false,
        message: `${student.first_name} has already completed the highest grade level offered here.`,
      });
    }

    const onFile = await getDocumentsOnFileForStudent(student.id);
    // A returning learner, so the returning-learner checklist.
    const types = await getRequiredDocumentTypes(undefined, 'returning');
    res.json({
      found: true,
      promotable: true,
      student: {
        id: student.id,
        firstName: student.first_name,
        middleName: student.middle_name,
        lastName: student.last_name,
      },
      currentGrade: student.current_grade,
      currentSchoolYear: student.current_school_year,
      nextGradeLevelId: student.next_grade_level_id,
      nextGradeLevelName: student.next_grade_level_name,
      documentsOnFile: onFile,
      documentsNeeded: types.map((t) => t.code).filter((t) => !onFile.includes(t)),
      documentTypes: types.map((t) => ({ code: t.code, label: t.label, required: true })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not look up that student.' });
  }
}

/**
 * "Is this learner's name already taken?" — answered while the parent types,
 * so the form can say so before the application is refused. It reports only
 * that the name exists and where that learner is enrolled, never anything
 * else about them.
 */
async function nameTaken(req, res) {
  try {
    const { firstName, middleName, lastName } = req.query;
    if (!firstName || !lastName) return res.json({ taken: false });
    const match = await findStudentByFullName({ firstName, middleName, lastName });
    if (!match) return res.json({ taken: false });
    res.json({ taken: true, message: duplicateNameMessage(match) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not check that name.' });
  }
}

async function addLrn(req, res) {
  try {
    const studentId = req.params.id;
    const lrn = typeof (req.body || {}).lrn === 'string' ? req.body.lrn.trim() : '';

    if (!/^\d{12}$/.test(lrn)) {
      return res.status(400).json({ message: 'LRN should be exactly 12 digits.' });
    }
    if (!(await guardianOwnsStudent(req.user.id, studentId))) {
      return res.status(403).json({ message: 'That student is not linked to your account.' });
    }

    const added = await addLrnIfMissing(studentId, lrn);
    if (!added) {
      return res.status(409).json({ message: 'This student already has an LRN on file. Contact the school to correct it.' });
    }
    res.json({ message: 'LRN saved.' });
  } catch (err) {
    // An LRN already against another learner is refused by name, before the
    // write; this also catches the unique index, for two requests at once.
    if (err.status && err.status < 500) {
      return res.status(err.status).json({
        message: err.message, ...(err.reason ? { reason: err.reason } : {}),
      });
    }
    if (err.code === '23505') {
      return res.status(409).json({ message: 'That LRN is already on file for another student.' });
    }
    console.error(err);
    res.status(500).json({ message: 'Could not save that LRN.' });
  }
}

module.exports = { lookup, addLrn, nameTaken };
