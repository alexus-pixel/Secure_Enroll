// One definition of "is enrollment open?", shared by the public landing-page
// API and by the application endpoints, so the website can never say
// "closed" while the server still accepts applications (or the reverse).
//
// A school year has an enrollment window (opens_at .. closes_at, both
// inclusive dates) and an on/off switch the administrator controls
// (enrollment_open). Enrollment is OPEN only when today is inside the window
// AND the switch is on. Dates are judged in Philippine time.

const TZ = 'Asia/Manila';

function manilaToday(now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// opens_at / closes_at come from Postgres as Date objects (or ISO strings).
function dateOnly(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // Judge the stored instant in Philippine time: a date typed as "2026-06-01"
  // is midnight in the database's time zone (UTC on Neon, +08 locally), and
  // both land on June 1 in Manila.
  return manilaToday(d);
}

function daysBetween(fromYmd, toYmd) {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/**
 * @returns {{
 *   state: 'open' | 'upcoming' | 'closed' | 'none',
 *   reason: 'no_school_year' | 'not_started' | 'ended' | 'paused' | 'full' | 'open',
 *   schoolYear: string | null, opensOn: string | null, closesOn: string | null,
 *   daysUntilOpen: number | null, daysLeft: number | null, today: string
 * }}
 */
function computeEnrollment(year, now = new Date()) {
  const today = manilaToday(now);
  if (!year) {
    return { state: 'none', reason: 'no_school_year', schoolYear: null, opensOn: null, closesOn: null, daysUntilOpen: null, daysLeft: null, today };
  }
  const opensOn = dateOnly(year.opens_at);
  const closesOn = dateOnly(year.closes_at);
  // The day enrollment actually stopped taking applications, which is only
  // the planned closing date when the window ran all the way out
  // (school_years.enrollment_closed_at — see db/admin/settings.js).
  const closedOn = dateOnly(year.enrollment_closed_at);
  const base = { schoolYear: year.label, opensOn, closesOn, closedOn, today, daysUntilOpen: null, daysLeft: null };

  if (opensOn && today < opensOn) {
    return { ...base, state: 'upcoming', reason: 'not_started', daysUntilOpen: daysBetween(today, opensOn) };
  }
  if (closesOn && today > closesOn) {
    return { ...base, state: 'closed', reason: 'ended' };
  }
  if (!year.enrollment_open) {
    return { ...base, state: 'closed', reason: 'paused' };
  }
  // Every slot of every grade level is filled (see lib/seats.js).
  if (year.slots_full) {
    return { ...base, state: 'closed', reason: 'full' };
  }
  return { ...base, state: 'open', reason: 'open', daysLeft: closesOn ? daysBetween(today, closesOn) : null };
}

function formatLong(ymd) {
  if (!ymd) return '';
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' })
    .format(new Date(`${ymd}T00:00:00Z`));
}

// Plain-language explanation for a parent who tries to apply while not open.
function closedMessage(status) {
  if (status.state === 'none') return 'Enrollment is not currently open for any school year.';
  if (status.state === 'upcoming') return `Enrollment for School Year ${status.schoolYear} opens on ${formatLong(status.opensOn)}.`;
  // Where the day it closed is known, it is the day worth printing: a window
  // that was switched off early did not close on the date it was planning to.
  const on = status.closedOn ? ` on ${formatLong(status.closedOn)}` : '';
  if (status.reason === 'full') return `All slots for School Year ${status.schoolYear} are filled, so enrollment closed${on || ''}.`;
  if (status.reason === 'ended') return `Enrollment for School Year ${status.schoolYear} closed on ${formatLong(status.closedOn || status.closesOn)}.`;
  return `Enrollment for School Year ${status.schoolYear} is closed${on}. Please check back or visit the school office.`;
}

module.exports = { computeEnrollment, closedMessage, manilaToday };
