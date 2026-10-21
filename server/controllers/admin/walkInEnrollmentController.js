const walkInDb = require('../../db/admin/walkInEnrollment');
const { checkParentEmail } = require('../../lib/parentEmail');
const { sendVerificationEmail } = require('../authController');
const settingsDb = require('../../db/admin/settings');
const { logAudit } = require('../../lib/audit');
const { sendDbError } = require('../../utils/dbErrors');

async function requiredDocuments(req, res) {
  try {
    // ?kind=new or ?kind=returning narrows the list to what that kind of
    // enrollment is actually asked for; no kind means every required type.
    const kind = ['new', 'returning'].includes(req.query.kind) ? req.query.kind : null;
    res.json(await walkInDb.getRequiredDocumentTypes(kind));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load required document types.' });
  }
}

async function gradeLevels(req, res) {
  try {
    res.json(await walkInDb.getGradeLevels());
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load grade levels.' });
  }
}

async function sections(req, res) {
  try {
    const raw = req.query.gradeLevelId;
    if (raw === undefined || raw === '') return res.json([]); // no grade picked yet
    if (typeof raw !== 'string' || !/^\d{1,9}$/.test(raw) || Number(raw) <= 0) {
      return res.status(400).json({ message: 'Unrecognized grade level.' });
    }
    const gradeLevelId = Number(raw);
    res.json(await walkInDb.getSectionsForGrade(gradeLevelId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load sections.' });
  }
}

async function lookupByLrn(req, res) {
  try {
    const student = await walkInDb.findStudentByLrn(req.query.lrn);
    if (!student) return res.status(404).json({ message: 'No student found with that LRN.' });
    res.json(student);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not look up that LRN.' });
  }
}

/**
 * "Does this Gmail already have a parent account?" — answered while the
 * address is being typed at the front desk. Staff-only: it is behind the
 * same permission as creating the enrollment itself, because answering it
 * for anyone would turn the form into an account-existence oracle.
 */
async function guardianLookup(req, res) {
  try {
    const found = await walkInDb.findGuardianByEmail(req.query.email);
    // An address that already has an account is a real one by definition —
    // somebody has been signing in with it — so only a new one is checked.
    if (found && found.exists) return res.json({ ...found, deliverable: true });
    const check = await checkParentEmail(req.query.email);
    res.json({ ...found, deliverable: check.ok, deliverableReason: check.ok ? undefined : check.reason });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not check that email address.' });
  }
}

/** "Is this learner already on file?" — same name and birth date. */
async function studentDuplicateCheck(req, res) {
  try {
    const { firstName, middleName, lastName } = req.query;
    const match = await walkInDb.findDuplicateStudent({ firstName, middleName, lastName });
    res.json(match ? { duplicate: true, student: match } : { duplicate: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not check for an existing learner.' });
  }
}

async function create(req, res) {
  try {
    const activeYear = await settingsDb.getActiveSchoolYear();
    if (!activeYear) return res.status(404).json({ message: 'No active school year is set.' });

    // The parent's Gmail is their login and the only way the school can reach
    // them afterwards, so an address that cannot receive mail stops the
    // enrollment here rather than creating an account nobody can open.
    const emailCheck = await checkParentEmail(req.body.guardianEmail);
    if (!emailCheck.ok) {
      return res.status(400).json({
        message: emailCheck.reason, reason: 'email_undeliverable',
      });
    }

    const result = await walkInDb.createWalkInEnrollment({
      ...req.body, schoolYearId: activeYear.id, submittedBy: req.user.id,
    });

    // A brand-new account has to confirm its address before it can be used.
    // Sending the link now is also the only real proof the Gmail exists: if
    // nothing arrives, the parent tells the desk and the address is corrected.
    if (result.accountCreated && result.guardianUserId) {
      const mail = await sendVerificationEmail(result.guardianUserId, result.accountEmail, { setPassword: true });
      result.verificationSent = mail.ok;
    }

    await logAudit(req.user.id, 'WALKIN_ENROLLMENT_CREATED', 'enrollment_application', result.applicationId, req, {
      studentId: result.studentId, guardianAccountCreated: result.accountCreated,
      guardianEmail: result.accountEmail, missingRequiredDocuments: result.stillNeeded,
    });

    res.status(201).json(result);
  } catch (err) {
    // Errors thrown on purpose (wrong role, disabled account, bad
    // document code) carry their own status and a message that is
    // safe to show the admin. Everything else stays a generic 500.
    if (err.status && err.status < 500) {
      // `reason` lets the form react to the specific problem (point at the
      // duplicate learner, highlight the birth date) instead of only
      // printing the sentence.
      return res.status(err.status).json({
        message: err.message,
        ...(err.reason ? { reason: err.reason } : {}),
        ...(err.studentId ? { studentId: err.studentId } : {}),
        ...(err.missingDocuments ? { missingDocuments: err.missingDocuments } : {}),
      });
    }
    if (sendDbError(err, res)) return;
    // Unique violations: the database's duplicate-record defences.
    if (err.code === '23505') {
      const isLrn = /lrn/i.test(err.constraint || err.detail || '');
      return res.status(409).json({
        message: isLrn
          ? 'A student with that LRN already exists. Use "Old / Returning Student" and search by LRN instead.'
          : 'This student already has an application for the active school year.',
      });
    }
    console.error(err);
    res.status(500).json({ message: 'Could not complete this enrollment.' });
  }
}

module.exports = {
  requiredDocuments, gradeLevels, sections, lookupByLrn, create,
  guardianLookup, studentDuplicateCheck,
};