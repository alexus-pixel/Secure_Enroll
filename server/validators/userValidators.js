const { z } = require('zod');

// Same password policy as parent sign-up (8-72 bytes, upper, lower, number, special).
const { strongPassword, email, id, personName } = require('./common');

// Admin can create registrar or admin accounts here (parents
// self-register through the public flow). Whether the chosen role is
// a staff role is checked against the roles table in the controller.
// A staff account is created with its name in parts, the same three boxes the
// person later sees in Edit Profile, so nothing has to be guessed by splitting
// a full name on its spaces.
const createStaffUser = z.object({
  firstName: personName('First name'),
  lastName: personName('Last name'),
  middleInitial: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(2, 'Middle initial can be at most 2 characters.')
      .regex(/^[\p{L}][\p{L}.]?$/u, 'Middle initial should be a letter.').optional()
  ),
  email,
  // No password is accepted here, and none is set. The account is created
  // without a usable one and a verification link is emailed to the address;
  // the person chooses their own password from that link, which is also what
  // proves the address is really theirs. See usersController.create.
  roleId: id('Role'),
});

const updateUserRole = z.object({
  roleId: id('Role'),
});

const setUserActive = z.object({
  isActive: z.boolean({ invalid_type_error: 'isActive must be true or false.' }),
  // The administrator's own password, asked for again because switching an
  // account on or off is sensitive. It is only passed through here; whether it
  // is present and correct is checked in lib/confirmPassword.js.
  password: z.string({ invalid_type_error: 'Password must be text.' }).max(200).optional(),
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
