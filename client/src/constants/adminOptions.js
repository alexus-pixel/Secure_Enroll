// Predefined options for the Admin section forms — pick from these instead
// of retyping sample values every time you test or demo the app. Edit
// these lists directly if your team wants different names or values.

export const STAFF_ACCOUNT_OPTIONS = [
  { fullName: 'Maria Dela Cruz', email: 'maria.delacruz@secureenroll.edu' },
  { fullName: 'Juan Santos', email: 'juan.santos@secureenroll.edu' },
  { fullName: 'Angela Reyes', email: 'angela.reyes@secureenroll.edu' },
  { fullName: 'Mark Villanueva', email: 'mark.villanueva@secureenroll.edu' },
  { fullName: 'Christine Bautista', email: 'christine.bautista@secureenroll.edu' },
  { fullName: 'Ramon Torres', email: 'ramon.torres@secureenroll.edu' },
  { fullName: 'Jennifer Aquino', email: 'jennifer.aquino@secureenroll.edu' },
  { fullName: 'Paolo Mendoza', email: 'paolo.mendoza@secureenroll.edu' },
];

export const GRADE_LEVEL_OPTIONS = [
  { name: 'Kindergarten', levelOrder: 0 },
  { name: 'Grade 1', levelOrder: 1 },
  { name: 'Grade 2', levelOrder: 2 },
  { name: 'Grade 3', levelOrder: 3 },
  { name: 'Grade 4', levelOrder: 4 },
  { name: 'Grade 5', levelOrder: 5 },
  { name: 'Grade 6', levelOrder: 6 },
];

export const SECTION_NAME_OPTIONS = [
  'Sampaguita', 'Rosal', 'Gumamela', 'Ilang-Ilang', 'Waling-Waling',
  'Santan', 'Kalachuchi', 'Adelfa', 'Camia', 'Dama de Noche',
];

export const SECTION_CAPACITY_OPTIONS = [30, 35, 40, 45, 50];

export const SCHOOL_YEAR_OPTIONS = [
  { yearLabel: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31' },
  { yearLabel: '2026-2027', startDate: '2026-08-01', endDate: '2027-05-31' },
  { yearLabel: '2027-2028', startDate: '2027-08-01', endDate: '2028-05-31' },
  { yearLabel: '2028-2029', startDate: '2028-08-01', endDate: '2029-05-31' },
  { yearLabel: '2029-2030', startDate: '2029-08-01', endDate: '2030-05-31' },
];

// CHANGED: switched to UPPERCASE_WITH_UNDERSCORES to match the convention
// visible in your reference design (LOGIN_SUCCESS, LOGIN_FAILED,
// APPLICATION_APPROVED) — those two login actions and the application one
// are presumably already being logged elsewhere in the app (by Kyle's auth
// routes and whoever built application approval), not by the admin code.
// The ADMIN_* ones are what adminRoutes.js now writes.
export const AUDIT_ACTION_OPTIONS = [
  'ADMIN_CREATE_USER',
  'ADMIN_CHANGE_ROLE',
  'ADMIN_ACTIVATE_USER',
  'ADMIN_DEACTIVATE_USER',
  'ADMIN_CREATE_SCHOOL_YEAR',
  'ADMIN_SET_ACTIVE_SCHOOL_YEAR',
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'APPLICATION_APPROVED',
];