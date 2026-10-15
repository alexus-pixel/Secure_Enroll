const { z } = require('zod');

// Same password policy as parent sign-up (8-72 bytes, upper, lower, number, special).
const { strongPassword, email, id } = require('./common');

// Staff names may contain letters, spaces and . ' - only.
const fullName = z.string().trim().min(2, 'Full name is required.').max(120, 'Full name is too long.')
  .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'\u2019-]*$/u, 'Full name: use letters only (spaces, . \' - are fine).');

// Admin can create registrar or admin accounts here (parents
// self-register through the public flow). Whether the chosen role is
// a staff role is checked against the roles table in the controller.
const createStaffUser = z.object({
  fullName,
  email,
  password: strongPassword,
  roleId: id('Role'),
});

const updateUserRole = z.object({
  roleId: id('Role'),
});

const setUserActive = z.object({
  isActive: z.boolean({ invalid_type_error: 'isActive must be true or false.' }),
});

const resetPassword = z.object({
  newPassword: strongPassword,
});

// The dropdowns on the Users page always send a value, even when
// nothing is selected — that value is '', not an omitted field. An
// enum on its own rejects '' as invalid, so this preprocesses it to
// undefined first, making "no filter chosen" and "field not sent"
// behave identically instead of one of them 400ing.
const emptyStringToUndefined = (schema) =>
  z.preprocess((val) => (val === '' ? undefined : val), schema.optional());

const listUsersQuery = z.object({
  search: z.string().trim().max(100).optional(),
  role: emptyStringToUndefined(z.enum(['parent', 'registrar', 'admin'])),
  status: emptyStringToUndefined(z.enum(['active', 'locked', 'disabled'])),
  lastLoginFrom: z.string().datetime().optional().or(z.literal('')),
  lastLoginTo: z.string().datetime().optional().or(z.literal('')),
  page: z.coerce.number().int().positive().max(100000).default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
});

module.exports = { createStaffUser, updateUserRole, setUserActive, resetPassword, listUsersQuery };
