const { isValidGmail, normalizeGmail, GMAIL_MESSAGE } = require('../utils/validators');
const { checkEmailDomain } = require('../utils/emailDomain');
const { verifyEmailExists } = require('./emailVerification');
const { isBlocked, managedDomains } = require('./brevoDeliverability');

/**
 * The one gate every email address in this system passes through.
 *
 * An address here is never just a field: it is somebody's login, and it is the
 * only way the school can reach them afterwards — the verification link, the
 * status of an application, a missing requirement, a password reset. An
 * address that cannot receive mail produces an account nobody can open, and
 * nobody finds out until the parent is standing at the desk asking why no
 * email arrived.
 *
 * So an address is accepted only when all of this holds:
 *
 *   1. It is shaped like a real address, and for a parent or guardian, a Gmail
 *      one — the school asks for Gmail so there is one provider to support.
 *   2. Its domain is one the school's mail actually goes to: Gmail, anything
 *      listed in MAIL_ALLOWED_DOMAINS, or a domain this Brevo account is
 *      authenticated for (so school-domain staff addresses work without being
 *      written into the code). For a parent's address that list is the whole
 *      rule; for a staff one, see allowedDomain() below.
 *   3. The domain answers for mail — a plain DNS lookup, which catches
 *      gmial.com and gmail.co.
 *   4. The mailbox is not known to be dead: the reputation service's verdict,
 *      where a key is configured.
 *   5. Brevo is not already refusing it. A hard bounce or a spam report puts an
 *      address on Brevo's blocked list, and mail to it is discarded silently.
 *
 * What it cannot do: prove a well-formed gmail.com mailbox exists. Google
 * refuses the mailbox-level probe, so an unused address comes back "unknown"
 * and passes. Only the verification link the person opens proves it, which is
 * why one is sent the moment an account is made.
 *
 * Every outside check fails OPEN. A DNS timeout, Brevo being down, a spent API
 * quota — none of those are evidence against the person, and none of them may
 * stop an enrollment. `checked` says whether anything outside this server
 * actually answered.
 */

/** Domains the school's mail is known to reach, besides Brevo's own. */
function configuredDomains() {
  const raw = (process.env.MAIL_ALLOWED_DOMAINS || 'gmail.com').toLowerCase();
  return raw.split(',').map((d) => d.trim().replace(/^@/, '')).filter(Boolean);
}

/**
 * Is this domain one the school's mail service handles?
 *
 * `strict` is for the addresses the school asks to be Gmail — a parent's or a
 * guardian's. There, the configured list IS the rule: anything else is refused
 * whether or not Brevo has an opinion.
 *
 * For a staff or teacher address the rule is weaker on purpose, because those
 * live on whatever domain the school uses. Brevo decides when it can: a domain
 * that is neither on the configured list nor authenticated in Brevo is
 * refused. When Brevo is not configured or does not answer, there is nothing
 * to refuse on, and the DNS check that follows is what stands.
 */
async function allowedDomain(domain, strict) {
  const allowed = configuredDomains();
  if (allowed.includes(domain)) return { ok: true };

  const brevo = await managedDomains();
  if (brevo && brevo.includes(domain)) return { ok: true };

  if (strict) {
    return {
      ok: false,
      reason: `The school can only send mail to ${allowed.join(', ')} addresses. Use one of those.`,
    };
  }
  if (brevo === null) return { ok: true };
  return {
    ok: false,
    reason: `The school's mail service is not set up to deliver to ${domain} addresses. `
      + `Use a ${allowed.join(' or ')} address, or add ${domain} to the sending domains in Brevo.`,
  };
}

/**
 * @param {string} email
 * @param {{ requireGmail?: boolean }} options requireGmail defaults to true:
 *   parents and guardians are asked for Gmail. Staff addresses may sit on the
 *   school's own domain, so their callers pass false.
 * @returns {Promise<{ok: boolean, reason?: string, email?: string, checked?: boolean}>}
 */
async function checkEmailAcceptable(email, { requireGmail = true } = {}) {
  const value = normalizeGmail(email);
  if (requireGmail) {
    if (!isValidGmail(value)) return { ok: false, reason: GMAIL_MESSAGE };
  } else if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value)) {
    return { ok: false, reason: 'Enter a valid email address.' };
  }

  const domain = value.split('@')[1] || '';
  const domainAllowed = await allowedDomain(domain, requireGmail);
  if (!domainAllowed.ok) return { ok: false, reason: domainAllowed.reason };

  const mail = await checkEmailDomain(value);
  if (!mail.ok) return { ok: false, reason: mail.reason };

  const reputation = await verifyEmailExists(value);
  if (!reputation.ok) {
    return { ok: false, reason: reputation.reason || 'That email address does not appear to exist.' };
  }

  const blocked = await isBlocked(value);
  if (blocked.blocked) return { ok: false, reason: blocked.reason };

  return { ok: true, email: value, checked: reputation.checked === true || blocked.checked === true };
}

module.exports = { checkEmailAcceptable, configuredDomains };
