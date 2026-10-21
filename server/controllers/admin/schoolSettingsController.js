const schoolDb = require('../../db/admin/schoolSettings');
const rollover = require('../../lib/schoolYearRollover');
const { schoolYearLabelFor } = require('../../validators/settingsValidators');
const { sendDbError } = require('../../utils/dbErrors');
const settingsDb = require('../../db/admin/settings');
const { logAudit } = require('../../lib/audit');
const pool = require('../../db/pool');

async function overview(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    const [schoolYears, gradeLevels, sections] = await Promise.all([
      schoolDb.listSchoolYears(),
      schoolDb.listGradeLevels(),
      activeYear ? schoolDb.listSectionsWithEnrollment(activeYear.id) : [],
    ]);
    res.json({ schoolYears, gradeLevels, sections, activeSchoolYearId: activeYear?.id || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load school settings.' });
  }
}

async function createSchoolYear(req, res) {
  try {
    // The name is the two years of the dates, so the two can never disagree.
    const label = schoolYearLabelFor(req.body.opensAt);
    const year = await schoolDb.createSchoolYear({ ...req.body, label });
    await logAudit(req.user.id, 'SCHOOL_YEAR_CREATED', 'school_year', year.id, req, { label: year.label });
    res.status(201).json(year);
  } catch (err) {
    if (sendDbError(err, res)) return;
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

/**
 * Starts the next school year by hand, with the dates the administrator
 * enters, and copies the sections, subjects and every teacher's schedule into
 * it (see lib/schoolYearRollover.js). The same thing happens on its own when
 * a school year's end date passes.
 */
async function rolloverSchoolYear(req, res) {
  const client = await pool.connect();
  try {
    const { rows: [from] } = await client.query(
      'SELECT id, label, opens_at, closes_at FROM school_years WHERE id = $1',
      [Number(req.params.id)]
    );
    if (!from) return res.status(404).json({ message: 'School year not found.' });

    await client.query('BEGIN');
    const result = await rollover.createFollowingYear(client, from, {
      opensAt: req.body?.opensAt, closesAt: req.body?.closesAt,
    });
    if (!result.created) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: `School year ${result.label} already exists.`, schoolYearId: result.id });
    }
    if (req.body?.activate !== false) await rollover.activate(client, result.id);
    await client.query('COMMIT');

    await logAudit(req.user.id, 'SCHOOL_YEAR_ROLLED_OVER', 'school_year', result.id, req, {
      from: from.label, to: result.label, copied: result.copied,
    });
    res.status(201).json(result);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (sendDbError(err, res)) return;
    console.error(err);
    res.status(500).json({ message: 'Could not start the next school year.' });
  } finally {
    client.release();
  }
}

/** Sets or clears the adviser of one section. */
async function setSectionAdviser(req, res) {
  try {
    const teacherId = req.body.teacherId === null ? null : Number(req.body.teacherId);
    const section = await schoolDb.setSectionAdviser(Number(req.params.id), teacherId);
    if (!section) return res.status(404).json({ message: 'Section not found.' });
    await logAudit(req.user.id, teacherId ? 'SECTION_ADVISER_SET' : 'SECTION_ADVISER_CLEARED', 'section', section.id, req, { teacherId });
    res.json(section);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (sendDbError(err, res)) return;
    console.error(err);
    res.status(500).json({ message: 'Could not set the adviser.' });
  }
}

/** Active teachers, for the adviser drop-down. */
async function teacherOptions(req, res) {
  try {
    res.json(await schoolDb.listTeacherOptions());
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load the teachers.' });
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
    if (err.status) return res.status(err.status).json({ message: err.message, reason: 'duplicate_section_name' });
    if (sendDbError(err, res)) return;
    if (err.code === '23505') {
      return res.status(409).json({
        message: 'A section with that name already exists in this school year. A section name has to be unique across the whole school.',
        reason: 'duplicate_section_name',
      });
    }
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
    if (sendDbError(err, res)) return;
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    res.status(500).json({ message: 'Could not update section capacity.' });
  }
}

/** Renames one section, with the whole-school-year name rule. */
async function updateSectionName(req, res) {
  try {
    const updated = await schoolDb.updateSectionName(Number(req.params.id), req.body.name);
    if (!updated) return res.status(404).json({ message: 'Section not found.' });
    await logAudit(req.user.id, 'SECTION_RENAMED', 'section', updated.id, req, { name: updated.name });
    res.json(updated);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        message: err.message, ...(err.reason ? { reason: err.reason } : {}),
      });
    }
    if (sendDbError(err, res)) return;
    if (err.code === '23505') {
      return res.status(409).json({
        message: 'A section with that name already exists in this school year. A section name has to be unique across the whole school.',
        reason: 'duplicate_section_name',
      });
    }
    console.error(err);
    res.status(500).json({ message: 'Could not rename the section.' });
  }
}

/** The learners enrolled in one section (name, sex, date approved). */
async function sectionStudents(req, res) {
  try {
    const data = await schoolDb.listSectionStudents(Number(req.params.id));
    if (!data) return res.status(404).json({ message: 'Section not found.' });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load the learners in this section.' });
  }
}

async function deleteSection(req, res) {
  try {
    const deleted = await schoolDb.deleteSection(Number(req.params.id));
    if (!deleted) return res.status(404).json({ message: 'Section not found.' });
    await logAudit(req.user.id, 'SECTION_DELETED', 'section', deleted.id, req);
    res.json({ deleted: true });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        message: err.message, ...(err.reason ? { reason: err.reason } : {}),
      });
    }
    console.error(err);
    res.status(500).json({ message: 'Could not remove section.' });
  }
}

/**
 * Moves one school year's dates. Both dates may be sent while the year has
 * not begun yet; once it has begun, only the end date reaches the database
 * and a start date sent anyway is refused by name (see
 * db/admin/schoolSettings.js). The same endpoint is what confirms the
 * provisional dates of a school year the system created by itself.
 */
async function updateSchoolYearDates(req, res) {
  try {
    const year = await schoolDb.updateSchoolYearDates(Number(req.params.id), {
      opensAt: req.body.opensAt,
      closesAt: req.body.closesAt,
      classesStartOn: req.body.classesStartOn,
    });
    if (!year) return res.status(404).json({ message: 'School year not found.' });
    await logAudit(
      req.user.id,
      req.body.opensAt ? 'SCHOOL_YEAR_DATES_UPDATED' : 'SCHOOL_YEAR_END_DATE_UPDATED',
      'school_year', year.id, req,
      { opensAt: req.body.opensAt, closesAt: req.body.closesAt, label: year.label }
    );
    res.json(year);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        message: err.message, ...(err.reason ? { reason: err.reason } : {}),
      });
    }
    if (sendDbError(err, res)) return;
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Another school year already covers those dates.' });
    }
    console.error(err);
    res.status(500).json({ message: 'Could not update the school year dates.' });
  }
}

module.exports = {
  overview, createSchoolYear, activateSchoolYear, updateSchoolYearDates,
  createSection, updateSectionCapacity, deleteSection,
  rolloverSchoolYear, setSectionAdviser, teacherOptions,
  updateSectionName, sectionStudents,
};
