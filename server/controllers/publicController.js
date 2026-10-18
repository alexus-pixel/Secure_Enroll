const pool = require('../db/pool');
const { getActiveSchoolYear } = require('../db/admin/settings');
const { computeEnrollment } = require('../utils/enrollmentStatus');
const { gradeSeats } = require('../lib/seats');

// Public, unauthenticated facts for the landing page. Nothing personal or
// operational is exposed here: only the school year label, the enrollment
// window, the grade levels and the list of documents parents should prepare.
async function enrollmentInfo(req, res) {
  try {
    const year = await getActiveSchoolYear();
    const [grades, docs] = await Promise.all([
      pool.query('SELECT name FROM grade_levels ORDER BY sort_order'),
      pool.query('SELECT code, label, is_required FROM required_document_types WHERE is_required ORDER BY sort_order, id'),
    ]);
    const seats = year ? await gradeSeats(pool, year.id) : [];
    res.set('Cache-Control', 'no-cache');
    res.json({
      enrollment: computeEnrollment(year),
      gradeLevels: grades.rows.map((g) => g.name),
      documents: docs.rows.map((d) => ({ code: d.code, label: d.label, required: d.is_required })),
      // Slots left per grade, from the sections and "slots" set in School Settings.
      grades: seats.map((g) => ({ gradeLevelId: g.id, name: g.name, slotsLeft: g.left, totalSlots: g.capacity, sections: g.sectionCount })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load enrollment information.' });
  }
}

module.exports = { enrollmentInfo };
