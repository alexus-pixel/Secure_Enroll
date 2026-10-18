const pool = require('../db/pool');
const { getActiveSchoolYear } = require('../db/admin/settings');
const { computeEnrollment } = require('../utils/enrollmentStatus');

// Public, unauthenticated facts for the landing page. Nothing personal or
// operational is exposed here: only the school year label, the enrollment
// window, the grade levels and the list of documents parents should prepare.
async function enrollmentInfo(req, res) {
  try {
    const year = await getActiveSchoolYear();
    const [grades, docs] = await Promise.all([
      pool.query('SELECT name FROM grade_levels ORDER BY sort_order'),
      pool.query('SELECT label, is_required FROM required_document_types ORDER BY sort_order, id'),
    ]);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      enrollment: computeEnrollment(year),
      gradeLevels: grades.rows.map((g) => g.name),
      documents: docs.rows.map((d) => ({ label: d.label, required: d.is_required })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load enrollment information.' });
  }
}

module.exports = { enrollmentInfo };
