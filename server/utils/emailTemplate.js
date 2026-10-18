// Branded layout for the account emails (verification and password reset).
// Plain tables and inline styles only, because email programs ignore most CSS.
// Every value that comes from outside is escaped before it goes into the HTML.
const SCHOOL = 'Caloocan City Elementary School';
const SYSTEM = 'Online Enrollment System';
const ACCENT = '#1E4FA3';

const escapeHtml = (v) => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// parts: { preheader, heading, greeting, paragraphs[], button: { label, url }, steps[], notice }
function renderEmail(parts) {
  const { preheader = '', heading, greeting, paragraphs = [], button, steps = [], notice = '' } = parts;
  const p = (t) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#16212E;">${escapeHtml(t)}</p>`;

  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#F3F5F8;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F8;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #DCE3EA;border-radius:10px;overflow:hidden;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
<tr><td style="background:${ACCENT};padding:22px 28px;">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#C9D8F2;">${escapeHtml(SYSTEM)}</div>
<div style="font-size:20px;font-weight:600;color:#FFFFFF;margin-top:4px;">${escapeHtml(SCHOOL)}</div>
</td></tr>
<tr><td style="padding:28px;">
<h1 style="margin:0 0 18px;font-size:20px;line-height:1.3;color:#16212E;">${escapeHtml(heading)}</h1>
${p(greeting)}
${paragraphs.map(p).join('\n')}
${button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;"><tr><td style="background:${ACCENT};border-radius:6px;">
<a href="${escapeHtml(button.url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;">${escapeHtml(button.label)}</a>
</td></tr></table>
<p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#5B6B7C;">If the button does not work, copy this link into your browser:</p>
<p style="margin:0 0 20px;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${escapeHtml(button.url)}" style="color:${ACCENT};">${escapeHtml(button.url)}</a></p>` : ''}
${steps.length ? `<div style="background:#E4ECF9;border-radius:8px;padding:14px 18px;margin:0 0 20px;">
<div style="font-size:13px;font-weight:600;color:#163B7C;margin-bottom:6px;">What happens next</div>
<ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.6;color:#16212E;">${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
</div>` : ''}
${notice ? `<p style="margin:0;font-size:13px;line-height:1.6;color:#5B6B7C;">${escapeHtml(notice)}</p>` : ''}
</td></tr>
<tr><td style="border-top:1px solid #DCE3EA;padding:16px 28px;font-size:12px;line-height:1.5;color:#7A8896;">
${escapeHtml(SCHOOL)} &middot; ${escapeHtml(SYSTEM)}<br>This is an automated message. Please do not reply to this email.
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    `${SCHOOL} - ${SYSTEM}`, '', heading, '', greeting, '',
    ...paragraphs.flatMap((t) => [t, '']),
    ...(button ? [`${button.label}:`, button.url, ''] : []),
    ...(steps.length ? ['What happens next:', ...steps.map((s, i) => `${i + 1}. ${s}`), ''] : []),
    ...(notice ? [notice, ''] : []),
    '--', `${SCHOOL}`, 'This is an automated message. Please do not reply.',
  ].join('\n');

  return { html, text };
}

module.exports = { renderEmail, SCHOOL, SYSTEM };
