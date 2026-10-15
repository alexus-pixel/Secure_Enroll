const {
  findReturningStudentForGuardian, getDocumentsOnFileForStudent, guardianOwnsStudent, addLrnIfMissing,
} = require('../db/students');

const DOC_TYPES = ['birth_certificate', 'form_138', 'good_moral'];

async function lookup(req, res) {
  try {
    const lrn = (req.query.lrn || '').toString().trim();
    if (!lrn) {
      return res.status(400).json({ message: 'Enter an LRN to search.' });
    }

    const student = await findReturningStudentForGuardian(lrn, req.user.id);
    if (!student) {
      return res.json({ found: false });
    }

    if (!student.next_grade_level_id) {
      return res.json({
        found: true,
        promotable: false,
        message: `${student.first_name} has already completed the highest grade level offered here.`,
      });
    }

    const onFile = await getDocumentsOnFileForStudent(student.id);
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
      documentsNeeded: DOC_TYPES.filter((t) => !onFile.includes(t)),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not look up that student.' });
  }
}

async function addLrn(req, res) {
  try {
    const studentId = req.params.id;
    const lrn = (req.body.lrn || '').toString().trim();

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
    if (err.code === '23505') {
      return res.status(409).json({ message: 'That LRN is already on file for another student.' });
    }
    console.error(err);
    res.status(500).json({ message: 'Could not save that LRN.' });
  }
}

module.exports = { lookup, addLrn };
