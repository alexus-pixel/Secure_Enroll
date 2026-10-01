/**
 * A tiny CSV writer. No new dependency for something this small —
 * but escaping is still done properly: any field containing a
 * comma, quote, or newline gets wrapped in quotes with internal
 * quotes doubled, per RFC 4180. Skipping that is how a registrar's
 * "Reyes, Andrea" or a remark containing a comma quietly corrupts
 * every column after it when opened in Excel.
 */
function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(rows, columns) {
  const header = columns.map((c) => escapeCsvField(c.label)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => escapeCsvField(typeof c.value === 'function' ? c.value(row) : row[c.value])).join(',')
  );
  return [header, ...lines].join('\r\n');
}

module.exports = { toCsv };
