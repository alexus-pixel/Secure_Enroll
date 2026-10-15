const bcrypt = require('bcryptjs');
const usersDb = require('../../db/admin/users');
const { logAudit } = require('../../lib/audit');
const { sendDbError } = require('../../utils/dbErrors');

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
    const { fullName, email, password, roleId } = req.body;

    const existing = await usersDb.findUserByEmail(email);
    if (existing) return res.status(409).json({ message: 'An account with that email already exists.' });

    const role = (await usersDb.getRoles()).find((r) => r.id === roleId);
    if (!role) return res.status(400).json({ message: 'Unknown role.' });
    if (role.name === 'parent') {
      return res.status(400).json({ message: 'Parent accounts self-register and cannot be created here.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await usersDb.createStaffUser({ email, fullName, passwordHash, roleId });

    await logAudit(req.user.id, 'USER_CREATED', 'user', user.id, req, { email, role: role.name });
    res.status(201).json(user);
  } catch (err) {
    if (sendDbError(err, res)) return;
    if (err.code === '23505') return res.status(409).json({ message: 'An account with that email already exists.' });
    console.error(err);
    res.status(500).json({ message: 'Could not create user.' });
  }
}

async function updateRole(req, res) {
  try {
    const targetId = Number(req.params.id);
    if (sameUser(targetId, req)) {
      return res.status(400).json({ message: "You can't change your own role." });
    }
    const before = await usersDb.findUserById(targetId);
    if (!before) return res.status(404).json({ message: 'User not found.' });

    const role = (await usersDb.getRoles()).find((r) => r.id === req.body.roleId);
    if (!role) return res.status(400).json({ message: 'Unknown role.' });

    const updated = await usersDb.updateUserRole(targetId, req.body.roleId);
    await logAudit(req.user.id, 'USER_ROLE_CHANGED', 'user', targetId, req, {
      from: before.role, toRoleId: req.body.roleId,
    });
    res.json(updated);
  } catch (err) {
    if (sendDbError(err, res)) return;
    console.error(err);
    res.status(500).json({ message: 'Could not update role.' });
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

async function resetPassword(req, res) {
  try {
    const targetId = Number(req.params.id);
    const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    const updated = await usersDb.resetPassword(targetId, passwordHash);
    if (!updated) return res.status(404).json({ message: 'User not found.' });

    // Never log the password itself, even hashed — the audit log
    // is meant to be reviewable by other admins, and a password
    // hash is still something an attacker who reads the log
    // shouldn't be handed for free.
    await logAudit(req.user.id, 'USER_PASSWORD_RESET', 'user', targetId, req);
    res.json({ id: updated.id, email: updated.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not reset password.' });
  }
}

module.exports = { list, counts, roles, create, updateRole, setActive, resetPassword };
