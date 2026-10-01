const { z } = require('zod');

// Matches authController.register's own rule (>= 8 chars) and adds
// the complexity check the concept paper's "strong authentication"
// objective calls for: at least one letter and one number, so
// "12345678" and "password" both still fail.
const strongPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .regex(/[A-Za-z]/, 'Password must include at least one letter.')
  .regex(/[0-9]/, 'Password must include at least one number.');

const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(255);

// Admin can create registrar or admin accounts here (parents
// self-register through the public flow). Rejecting role: 'parent'
// at the schema level closes off one way this endpoint could be
// misused to mint parent accounts that skip normal registration.
const createStaffUser = z.object({
  fullName: z.string().trim().min(2).max(120),
  email,
  password: strongPassword,
  roleId: z.coerce.number().int().positive(),
});

const updateUserRole = z.object({
  roleId: z.coerce.number().int().positive(),
});

const setUserActive = z.object({
  isActive: z.boolean(),
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
  search: z.string().trim().max(255).optional(),
  role: emptyStringToUndefined(z.enum(['parent', 'registrar', 'admin'])),
  status: emptyStringToUndefined(z.enum(['active', 'locked', 'disabled'])),
  lastLoginFrom: z.string().datetime().optional().or(z.literal('')),
  lastLoginTo: z.string().datetime().optional().or(z.literal('')),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
});

module.exports = { createStaffUser, updateUserRole, setUserActive, resetPassword, listUsersQuery };
