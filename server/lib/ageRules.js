/**
 * The birth date rule, and how young is too young for a grade level.
 *
 * There is no upper age limit. Elementary schools here admit over-age learners
 * who started late, repeated a year, transferred in, or are adults finishing
 * what they began years ago, and a maximum in the form would turn each of
 * those into an argument at the front desk rather than a decision the school
 * gets to make.
 *
 * There is a lower one. A four-year-old cannot be put into Grade 1, whatever
 * the paperwork says, and a learner who is years younger than the grade they
 * are being enrolled into is a typo in the birth date far more often than a
 * prodigy. The minimum is one year below DepEd's normal entry age for each
 * grade, which leaves room for a child who turns the usual age during the
 * school year:
 *
 *     Kinder   4        Grade 3   7
 *     Grade 1  5        Grade 4   8
 *     Grade 2  6        Grade 5   9
 *                       Grade 6  10
 *
 * Age is counted on the first day of the school year, not the day the form is
 * filled in, because that is the age the learner will be sitting in the class.
 * Grades are identified by sort_order (Kinder is 0), never by id: ids drift
 * between databases, the order does not.
 *
 * The browser copy of this is in client/src/utils/validators.js — change both
 * together. The server is the one that decides.
 */

// sort_order -> the youngest a learner may be, in whole years, on the first
// day of the school year.
const MIN_AGE_BY_SORT_ORDER = [4, 5, 6, 7, 8, 9, 10];
// Anything beyond the grades we know about keeps climbing by a year.
const minAgeFor = (sortOrder) => (
  sortOrder < MIN_AGE_BY_SORT_ORDER.length
    ? MIN_AGE_BY_SORT_ORDER[sortOrder]
    : MIN_AGE_BY_SORT_ORDER[MIN_AGE_BY_SORT_ORDER.length - 1] + (sortOrder - MIN_AGE_BY_SORT_ORDER.length + 1)
);

/** Parses YYYY-MM-DD into a UTC date, or null if that calendar date does not exist. */
function parseIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/** Whole years between two dates. Also used for display (a learner's age on a list). */
function ageOn(birthDate, referenceDate) {
  const birth = birthDate instanceof Date ? birthDate : parseIsoDate(birthDate);
  const ref = referenceDate instanceof Date ? referenceDate : parseIsoDate(referenceDate);
  if (!birth || !ref) return null;
  const age = ref.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday = ref.getUTCMonth() < birth.getUTCMonth()
    || (ref.getUTCMonth() === birth.getUTCMonth() && ref.getUTCDate() < birth.getUTCDate());
  return beforeBirthday ? age - 1 : age;
}

/**
 * Checks one birth date on its own: it has to be a real calendar date and it
 * cannot be in the future. Returns '' when it is fine, or the sentence to show.
 */
function checkBirthDate(birthDate) {
  const birth = parseIsoDate(birthDate);
  if (!birth) return 'Enter the birth date as a valid date.';
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (birth > todayUtc) return 'The birth date cannot be in the future.';
  return '';
}

/**
 * The same check, plus "is this learner old enough for this grade level".
 *
 * `grade` is { sortOrder, name }. Passing no grade, or one without a sort
 * order, checks only the date itself — which is what the callers that do not
 * know the grade yet rely on.
 *
 * `yearStartsOn` is the first day of the school year (YYYY-MM-DD). Without it
 * the age is counted today, which is the safe direction: a learner who is old
 * enough now will still be old enough when classes start.
 */
function checkBirthDateForGrade(birthDate, grade = null, yearStartsOn = null) {
  const basic = checkBirthDate(birthDate);
  if (basic) return basic;
  if (!grade || grade.sortOrder === undefined || grade.sortOrder === null) return '';

  const reference = parseIsoDate(yearStartsOn) || new Date();
  const age = ageOn(birthDate, reference);
  const minimum = minAgeFor(Number(grade.sortOrder));
  if (age === null || age >= minimum) return '';

  const name = grade.name || 'that grade level';
  return `A learner has to be at least ${minimum} years old to enter ${name}, and this birth date makes them `
    + `${age === 1 ? '1 year' : `${age} years`} old when classes start. Check the birth date, `
    + 'or enroll them into a lower grade level.';
}

module.exports = {
  parseIsoDate, ageOn, checkBirthDate, checkBirthDateForGrade, minAgeFor, MIN_AGE_BY_SORT_ORDER,
};
