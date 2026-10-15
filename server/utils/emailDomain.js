const dns = require('dns');

// A short list of well-known disposable / temporary-email providers.
// Not exhaustive -- new ones appear constantly -- but it catches the
// services people reach for first when they don't want to give a real
// address.
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', '10minutemail.com',
  'tempmail.com', 'temp-mail.org', 'throwawaymail.com', 'yopmail.com', 'trashmail.com',
  'fakeinbox.com', 'getnada.com', 'maildrop.cc', 'sharklasers.com', 'dispostable.com',
  'mailnesia.com', 'mintemail.com', 'moakt.com', 'mohmal.com', 'spamgourmet.com',
  'tempinbox.com', 'tempmailo.com', 'discard.email', 'emailondeck.com', 'mailcatch.com',
  'crazymailing.com', 'harakirimail.com', 'mailtemp.info', 'tempr.email',
]);

function isDisposableDomain(domain) {
  return DISPOSABLE_DOMAINS.has((domain || '').toLowerCase());
}

// Does the domain have any mail servers configured? This is a plain DNS
// lookup -- no third party involved, no API key, nothing sent anywhere
// but a standard DNS query -- so it can run on every registration for
// free. It proves the domain *could* receive mail; it can't confirm any
// particular mailbox exists (gmail.com will always pass this, whether or
// not the specific address in front of the @ is real).
function hasMxRecord(domain) {
  return new Promise((resolve) => {
    dns.resolveMx(domain, (err, addresses) => {
      if (!err) return resolve(Boolean(addresses && addresses.length > 0));
      // ENOTFOUND/ENODATA mean the domain genuinely has no mail setup --
      // a real signal the address is fake. Any other error (DNS resolver
      // timeout, our own network hiccup, ...) is our infrastructure's
      // problem, not evidence against the user, so don't block on it.
      if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') return resolve(false);
      resolve(true);
    });
  });
}

async function checkEmailDomain(email) {
  const domain = (email || '').split('@')[1];
  if (!domain) return { ok: false, reason: 'Enter a valid email address.' };
  if (isDisposableDomain(domain)) {
    return { ok: false, reason: 'Temporary or disposable email addresses are not allowed.' };
  }
  const hasMx = await hasMxRecord(domain);
  if (!hasMx) {
    return { ok: false, reason: "This email domain doesn't appear to accept mail. Check for a typo." };
  }
  return { ok: true };
}

module.exports = { isDisposableDomain, hasMxRecord, checkEmailDomain };
