// The checklist of documents comes from System Settings (required_document_types).
// Every page that talks about documents reads it from here, so a change made by
// the admin shows up for parents, the registrar and walk-in enrollment alike.
const pool = require('../db/pool');

async function getDocumentTypes(db = pool) {
  const { rows } = await db.query(
    'SELECT id, code, label, is_required AS "isRequired", sort_order FROM required_document_types ORDER BY sort_order, id'
  );
  return rows;
}

module.exports = { getDocumentTypes };
