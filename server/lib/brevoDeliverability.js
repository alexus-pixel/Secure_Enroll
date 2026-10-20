/**
 * What Brevo — the service that actually carries this school's mail — can tell
 * us about an address before an account is built on it.
 *
 * Two questions, and Brevo can answer both:
 *
 *   1. Can it send there at all? Brevo keeps a blocked list: every address
 *      that hard-bounced, was reported as spam, or unsubscribed. Sending to
 *      one of those is thrown away silently, so an account created on it is an
 *      account nobody can open. `isBlocked` asks that list.
 *
 *   2. Is the domain one Brevo handles? Mail from the school leaves through a
 *      Brevo sender, and a Brevo account's own authenticated domains are the
 *      ones it is set up for. `managedDomains` reads them, so a staff address
 *      on the school's own domain is accepted next to the Gmail addresses
 *      parents use, without that list being hardcoded here.
 *
 * Everything here fails OPEN. Brevo being unreachable, rate-limited, or not
 * configured at all is this system's problem, not evidence against the person
 * typing their address, and it must never stop an enrollment at the front
 * desk. Each call says whether it actually reached Brevo (`checked`), so the
 * caller can tell "Brevo says this is fine" from "Brevo did not answer".
 *
 * API docs: developers.brevo.com — GET /v3/smtp/blockedContacts/{email},
 * GET /v3/senders/domains.
 */

const BASE = () => (process.env.BREVO_API_BASE || 'https://api.brevo.com/v3').replace(/\/+$/, '');
const key = () => (process.env.BREVO_API_KEY || '').trim();

async function brevoGet(path) {
  if (!key()) return { reached: false, status: 0, body: null };
  try {
    const res = await fetch(`${BASE()}${path}`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'api-key': key(), accept: 'application/json' },
    });
    let body = null;
    try { body = await res.json(); } catch { /* an empty or non-JSON body is fine */ }
    return { reached: true, status: res.status, body };
  } catch (err) {
    console.error('Brevo lookup failed:', err.message);
    return { reached: false, status: 0, body: null };
  }
}

/**
 * Is this address on Brevo's blocked list?
 * @returns {Promise<{checked: boolean, blocked: boolean, reason?: string}>}
 */
async function isBlocked(email) {
  const address = String(email || '').trim().toLowerCase();
  if (!address) return { checked: false, blocked: false };
  const { reached, status, body } = await brevoGet(`/smtp/blockedContacts/${encodeURIComponent(address)}`);
  if (!reached) return { checked: false, blocked: false };
  // 404 is the good answer: Brevo has nothing against this address.
  if (status === 404) return { checked: true, blocked: false };
  if (status !== 200) return { checked: false, blocked: false };
  const why = body?.reason?.code || body?.reason?.message || '';
  return {
    checked: true,
    blocked: true,
    reason: why
      ? `Our mail service cannot deliver to that address (${String(why).replace(/_/g, ' ')}). Use a different one.`
      : 'Our mail service cannot deliver to that address, so the school would not be able to reach you. Use a different one.',
  };
}

// The domain list changes about never, so it is read once and kept for ten
// minutes: every address typed at the front desk would otherwise be a request.
let domainCache = { at: 0, domains: null };
const DOMAIN_TTL = 10 * 60 * 1000;

/**
 * The domains this Brevo account is authenticated to send for, lowercased.
 * Returns null when Brevo did not answer, which callers read as "no opinion".
 */
async function managedDomains() {
  if (domainCache.domains && Date.now() - domainCache.at < DOMAIN_TTL) return domainCache.domains;
  const { reached, status, body } = await brevoGet('/senders/domains');
  if (!reached || status !== 200) return null;
  const list = (body?.domains || body || [])
    .map((d) => String(d?.domain_name || d?.domain || d || '').trim().toLowerCase())
    .filter(Boolean);
  domainCache = { at: Date.now(), domains: list };
  return list;
}

/** Only for the tests, which must not inherit a cached list between cases. */
function clearDomainCache() {
  domainCache = { at: 0, domains: null };
}

module.exports = { isBlocked, managedDomains, clearDomainCache };
