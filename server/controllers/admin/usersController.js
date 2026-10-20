const bcrypt = require('bcryptjs');
const usersDb = require('../../db/admin/users');
const { logAudit } = require('../../lib/audit');
const { sendDbError } = require('../../utils/dbErrors');
const { checkEmailAcceptable } = require('../../lib/emailGate');

// A staff address may be on the school's own domain, so Gmail is not required
// of it — the rest of the gate is (lib/emailGate.js).
const checkStaffEmail = (email) => checkEmailAcceptable(email, { requireGmail: false });

// req.user.id comes from the token as a string; ids from the URL are numbers.
const sameUser = (targetId, req) => String(targetId) === String(req.user.id);

async function list(req, res) {
  try {
    const result = await usersDb.listUsers(req.query);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load users.' });
  }
}

async function counts(req, res) {
  try {
    res.json(await usersDb.getUserCounts());
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load user counts.' });
  }
}

async function roles(req, res) {
  try {
    res.json(await usersDb.getRoles());
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not load roles.' });
  }
}

async function create(req, res) {
  try {
    const { firstName, lastName, middleInitial, email, password, roleId } = req.body;

    const existing = await usersDb.findUserByEmail(email);
    if (existing) return res.status(409).json({ message: 'An account with that email already exists.' });

    // The same check the type-ahead runs, repeated here because the type-ahead
    // can be skipped: a staff account's password reset goes to this address,
    // so it has to be one that can receive mail.
    const deliverable = await checkStaffEmail(email);
    if (!deliverable.ok) return res.status(422).json({ message: deliverable.reason });

    const role = (await usersDb.getRoles()).find((r) => r.id === roleId);
    if (!role) return res.status(400).json({ message: 'Unknown role.' });
    if (role.name === 'parent') {
      return res.status(400).json({ message: 'Parent accounts self-register and cannot be created here.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await usersDb.createStaffUser({
      email, firstName, lastName, middleInitial, passwordHash, roleId,
    });

    await logAudit(req.user.id, 'USER_CREATED', 'user', user.id, req, { email, role: role.name });
    res.status(201).json(user);
  } catch (err) {
    if (sendDbError(err, res)) return;
    if (err.code === '23505') return res.status(409).json({ message: 'An account with that email already exists.' });
    console.error(err);
    res.status(500).json({ message: 'Could not create user.' });
  }
}


async function setActive(req, res) {
  try {
    const targetId = Number(req.params.id);
    if (sameUser(targetId, req) && req.body.isActive === false) {
      return res.status(400).json({ message: "You can't disable your own account." });
    }
    const updated = await usersDb.setUserActive(targetId, req.body.isActive);
    if (!updated) return res.status(404).json({ message: 'User not found.' });

    await logAudit(req.user.id, req.body.isActive ? 'USER_ENABLED' : 'USER_DISABLED', 'user', targetId, req);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not update user status.' });
  }
}


/**
 * "Is this address already somebody's account?" — answered while it is being
 * typed, so a clash is seen before the form is filled in rather than after it
 * is submitted. Also says whether the address can receive mail at all, which
 * matters because a staff account's password reset goes to it.
 */
async function checkEmail(req, res) {
  try {
    const email = String(req.query.email || '').trim();
    if (!email) return res.json({ available: false, reason: 'Enter an email address.' });
    const existing = await usersDb.findUserByEmail(email);
    if (existing) {
      return res.json({ available: false, reason: 'An account with that email address already exists.' });
    }
    const deliverable = await checkStaffEmail(email);
    if (!deliverable.ok) return res.json({ available: false, reason: deliverable.reason });
    res.json({ available: true });
  } catch (err) {
    // Our own check breaking is not evidence against the address, and create
    // re-checks everything anyway.
    console.error(err);
    res.json({ available: true });
  }
}

module.exports = { list, counts, roles, create, setActive, checkEmail };
