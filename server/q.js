// Usage (from the server folder): node q.js "SELECT ..."
const pool = require('./db/pool');

pool
  .query(process.argv[2])
  .then((r) => console.table(r.rows.length ? r.rows : [{ rowCount: r.rowCount }]))
  .catch((e) => console.error(e.message))
  .finally(() => pool.end());