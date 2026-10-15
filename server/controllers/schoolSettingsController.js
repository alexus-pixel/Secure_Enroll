const schoolDb = require('../../db/admin/schoolSettings');
const settingsDb = require('../../db/admin/settings');
const { logAudit } = require('../../lib/audit');

async function overview(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    const [schoolYears, sections] = await Promise.all([
      schoolDb.listSchoolYears(),
      activeYear ? schoolDb.listSectionsWithEnrollment(activeYear.id) : [],
    ]);
    res.json({ schoolYears, sections, activeSchoolYearId: activeYear?.id || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load school settings.' });
  }
}

async function createSchoolYear(req, res) {
  try {
    const year = await schoolDb.createSchoolYear(req.body);
    await logAudit(req.user.id, 'SCHOOL_YEAR_CREATED', 'school_year', year.id, req, { label: year.label });
    res.status(201).json(year);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'That school year already exists.' });
    console.error(err);
    res.status(500).json({ message: 'Could not create school year.' });
  }
}

async function activateSchoolYear(req, res) {
  try {
    const year = await schoolDb.setActiveSchoolYear(Number(req.params.id));
    if (!year) return res.status(404).json({ message: 'School year not found.' });
    await logAudit(req.user.id, 'SCHOOL_YEAR_ACTIVATED', 'school_year', year.id, req, { label: year.label });
    res.json(year);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not activate school year.' });
  }
}

async function createSection(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });
    const section = await schoolDb.createSection({ ...req.body, schoolYearId: activeYear.id });
    await logAudit(req.user.id, 'SECTION_CREATED', 'section', section.id, req, req.body);
    res.status(201).json(section);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'That section already exists for this grade level.' });
    console.error(err);
    res.status(500).json({ message: 'Could not create section.' });
  }
}

async function updateSectionCapacity(req, res) {
  try {
    const updated = await schoolDb.updateSectionCapacity(Number(req.params.id), req.body.capacity);
    if (!updated) return res.status(404).json({ message: 'Section not found.' });
    await logAudit(req.user.id, 'SECTION_CAPACITY_UPDATED', 'section', updated.id, req, { capacity: req.body.capacity });
    res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    res.status(500).json({ message: 'Could not update section capacity.' });
  }
}

module.exports = { overview, createSchoolYear, activateSchoolYear, createSection, updateSectionCapacity };
