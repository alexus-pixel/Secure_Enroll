/**
 * Checks whether an email address actually exists, using
 * AbstractAPI's Email Reputation API — the product this school's
 * account actually has (Email Validation, a separate product,
 * isn't offered as an addable product on this account at all).
 *
 * Confirmed endpoint and shape from docs.abstractapi.com/api/email-reputation:
 *   GET https://emailreputation.abstractapi.com/v1/?api_key=...&email=...
 *   {
 *     "email_address": "...",
 *     "email_deliverability": {
 *       "status": "deliverable" | "undeliverable" | "unknown",
 *       "status_detail": "valid_email" | "invalid_format" | "dns_record_not_found" | ...,
 *       "is_format_valid": true, "is_smtp_valid": true, "is_mx_valid": true,
 *       "mx_records": [...]
 *     },
 *     "email_quality": { "score": 0.xx, "is_free_email": true, ... },
 *     "email_risk": { "address_risk_status": "low"|"medium"|"high", ... },
 *     "email_breaches": { ... }
 *   }
 * Note the lowercase status values here — a different casing than
 * the (separate, unavailable-on-this-account) Email Validation API.
 *
 * Free tier: 100 requests/month. Key goes in ABSTRACT_EMAIL_API_KEY.
 *
 * Gmail, Outlook, and some other large providers block the SMTP
 * probe this relies on, which comes back as status "unknown" even
 * for a real, working address. Treating "unknown" as a hard
 * rejection would block a large share of genuine addresses, so
 * only a confirmed-bad result blocks teacher creation; "unknown"
 * passes through.
 */
async function verifyEmailExists(email) {
  const apiKey = process.env.ABSTRACT_EMAIL_API_KEY;
  if (!apiKey) {
    console.warn('ABSTRACT_EMAIL_API_KEY is not set — skipping email existence check.');
    return { checked: false, ok: true };
  }

  const url = `https://emailreputation.abstractapi.com/v1/?api_key=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}`;
  let data;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error('Email verification API returned', response.status);
      return { checked: false, ok: true }; // fail open: a provider outage shouldn't block hiring a teacher
    }
    data = await response.json();
  } catch (err) {
    console.error('Email verification API request failed:', err.message);
    return { checked: false, ok: true };
  }

  const deliverability = data.email_deliverability || {};
  // is_disposable_email's exact nesting isn't confirmed as precisely
  // as the deliverability fields, so this checks a couple of
  // plausible locations rather than assuming one — if none of them
  // are present, this check is simply skipped rather than guessed at.
  const isDisposable = data.email_quality?.is_disposable_email
    ?? deliverability.is_disposable_email
    ?? data.is_disposable_email;

  if (deliverability.is_format_valid === false) {
    return { checked: true, ok: false, reason: 'That doesn\u2019t look like a valid email address.' };
  }
  if (deliverability.status === 'undeliverable') {
    return { checked: true, ok: false, reason: 'That email address does not appear to exist.' };
  }
  if (isDisposable === true) {
    return { checked: true, ok: false, reason: 'Disposable/temporary email addresses are not allowed for staff accounts.' };
  }
  return { checked: true, ok: true };
}

module.exports = { verifyEmailExists };
