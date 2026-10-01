/**
 * Reference data for the Degree / Major fields on the Add Teacher
 * form. There is no public API for "Philippine education degree
 * programs and their majors" — the only real government
 * classification (the US Department of Education's CIP codes) is a
 * broad taxonomy covering every field of study, not a BEEd/BSEd-and-
 * majors structure, and isn't Philippine-specific anyway. This is a
 * standard, CHED-recognized list instead, served through our own
 * endpoint the same way subjects are.
 *
 * Each entry carries both the short code (what's actually stored)
 * and a full display label (what the dropdown shows), since the
 * two shouldn't be conflated — "BEEd" is what you'd search a
 * transcript for, "Bachelor of Elementary Education" is what you'd
 * want to read on screen.
 *
 * OTHER_CODE is a sentinel, never a real stored value. Selecting it
 * on the form reveals a free-text field, and whatever the admin
 * types there — not the literal word "Other" — is what actually
 * gets saved as the degree.
 */
const OTHER_CODE = 'OTHER';

const DEGREES = [
  { code: 'BEEd', label: 'Bachelor of Elementary Education', majors: ['Generalist'] },
  {
    code: 'BSEd', label: 'Bachelor of Secondary Education',
    majors: ['English', 'Filipino', 'Mathematics', 'Science', 'Social Studies', 'MAPEH', 'Values Education'],
  },
  {
    code: 'BTLEd', label: 'Bachelor of Technology and Livelihood Education',
    majors: ['Home Economics', 'Industrial Arts', 'Information and Communication Technology', 'Agri-Fishery Arts'],
  },
  { code: 'BPEd', label: 'Bachelor of Physical Education', majors: ['Generalist', 'Sports Coaching'] },
  { code: 'BSNEd', label: 'Bachelor of Special Needs Education', majors: ['Generalist'] },
  { code: OTHER_CODE, label: 'Other (type below)', majors: [] },
];

const DEGREE_MAJORS = Object.fromEntries(DEGREES.map((d) => [d.code, d.majors]));

function degreeOptions() {
  return DEGREES.map(({ code, label, majors }) => ({ degree: code, label, majors }));
}

// True for one of the five known, fixed-major degrees — used only
// to decide whether the strict degree/major pairing check below
// applies. A teacher's real stored degree is either one of these
// codes, or free text the admin typed after choosing "Other" — both
// are legitimate, so this is *not* used to reject a submission.
function isKnownDegreeCode(degree) {
  return Object.prototype.hasOwnProperty.call(DEGREE_MAJORS, degree) && degree !== OTHER_CODE;
}

// A recognized code's major must be one of that degree's listed
// majors. Anything else (a custom "Other" degree the admin typed,
// or no degree at all) has no fixed major list to check against,
// so any major value — including a blank one — is accepted.
function isValidMajor(degree, major) {
  if (!isKnownDegreeCode(degree)) return true;
  return DEGREE_MAJORS[degree].includes(major);
}

module.exports = { OTHER_CODE, DEGREE_MAJORS, degreeOptions, isKnownDegreeCode, isValidMajor };
