/**
 * The hours the school building is open, which every class period has to fit
 * inside.
 *
 * These used to be written into the schedule validator as 6 AM and 6 PM. They
 * are a school's own decision — a half-day school, an afternoon shift, a
 * school that starts at 7 — so the administrator sets them in System Settings
 * and the rule follows.
 *
 * They are read from the database once and kept in memory, because the
 * schedule validator is a plain synchronous function called on every field of
 * every period and cannot wait on a query. The cache is filled when the API
 * starts and replaced whenever the administrator saves new hours, so the only
 * window where it can be stale is between one API process saving and another
 * one noticing — which, with a single process, does not exist.
 *
 * Until the first load finishes, the old fixed hours stand: a validator that
 * answered "no opinion" would let a 3 AM period through on the first request
 * after a restart.
 */

const pool = require('../db/pool');

const DEFAULTS = { opensAt: '06:00', closesAt: '18:00' };
let cached = { ...DEFAULTS };

/** "06:00" or "6:00" -> "06:00", anything else -> null. */
function normalizeTime(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** The hours as they stand, without touching the database. */
function getHours() {
  return { ...cached };
}

/** Reads the hours from the database into the cache. Called at startup. */
async function loadHours(db = pool) {
  try {
    const { rows } = await db.query(
      "SELECT key, value FROM app_settings WHERE key IN ('day_opens_at', 'day_closes_at')"
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const opensAt = normalizeTime(byKey.day_opens_at) || DEFAULTS.opensAt;
    const closesAt = normalizeTime(byKey.day_closes_at) || DEFAULTS.closesAt;
    // A closing time at or before the opening time would refuse every period
    // ever typed, so a broken pair falls back rather than locking the school
    // out of its own timetable.
    cached = closesAt > opensAt ? { opensAt, closesAt } : { ...DEFAULTS };
  } catch (err) {
    console.error('[school hours] could not be read, using the defaults:', err.message);
    cached = { ...DEFAULTS };
  }
  return getHours();
}

/**
 * Saves new hours and updates the cache. Throws a 400-shaped error when the
 * pair does not make a day.
 */
async function setHours({ opensAt, closesAt }, db = pool) {
  const opens = normalizeTime(opensAt);
  const closes = normalizeTime(closesAt);
  if (!opens || !closes) {
    throw Object.assign(new Error('Enter both times as HH:MM, for example 06:00 and 18:00.'), { status: 400 });
  }
  if (closes <= opens) {
    throw Object.assign(new Error('The closing time has to be later than the opening time.'), { status: 400 });
  }

  // Periods already on the timetable that would fall outside the new hours.
  // Saving hours that orphan existing classes is almost always a typo, and
  // finding out later means hunting through every grade's schedule.
  const { rows: outside } = await db.query(
    `SELECT COUNT(*)::int AS n FROM schedule_entries
      WHERE role_type = 'subject'
        AND (start_time < $1::time OR end_time > $2::time)`,
    [opens, closes]
  );
  if (outside[0] && outside[0].n > 0) {
    throw Object.assign(
      new Error(`${outside[0].n} class ${outside[0].n === 1 ? 'period is' : 'periods are'} already scheduled outside `
        + `${opens}-${closes}. Move or remove ${outside[0].n === 1 ? 'it' : 'them'} first, or choose wider hours.`),
      { status: 409, reason: 'periods_outside_hours' }
    );
  }

  await db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('day_opens_at', $1, NOW()), ('day_closes_at', $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [opens, closes]
  );
  cached = { opensAt: opens, closesAt: closes };
  return getHours();
}

/** "06:00" -> "6:00 AM", for the sentences shown to staff. */
function clock(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

module.exports = { getHours, loadHours, setHours, normalizeTime, clock, DEFAULTS };
