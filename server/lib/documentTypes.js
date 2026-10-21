// The checklist of documents comes from System Settings (required_document_types).
// Every page that talks about documents reads it from here, so a change made by
// the admin shows up for parents, the registrar and walk-in enrollment alike.
const pool = require('../db/pool');

async function getDocumentTypes(db = pool) {
  const { rows } = await db.query(
    `SELECT id, code, label, is_required AS "isRequired", applies_to AS "appliesTo", sort_order
       FROM required_document_types ORDER BY sort_order, id`
  );
  return rows;
}

/**
 * Whether a document type is asked of this kind of enrollment.
 *
 * A first-time learner and a returning one are asked for different papers:
 * nobody has a report card before their first year, and a learner already on
 * file does not send their birth certificate twice. 'all' covers both, which
 * is what every type is until an administrator says otherwise.
 *
 * `kind` is 'new', 'returning', or null for "every type there is", which is
 * what the settings screen and the audit log want.
 */
function appliesToKind(type, kind) {
  if (!kind) return true;
  return type.appliesTo === 'all' || type.appliesTo === kind;
}

// Only the documents the administrator has checked in System Settings, and
// only those that apply to this kind of enrollment. These are the ones
// parents are asked to upload and walk-in staff can tick off.
async function getRequiredDocumentTypes(db = pool, kind = null) {
  return (await getDocumentTypes(db)).filter((t) => t.isRequired && appliesToKind(t, kind));
}

module.exports = { getDocumentTypes, getRequiredDocumentTypes, appliesToKind };
