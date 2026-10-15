// Checks route parameters (":id", ":studentId" ...) BEFORE they reach the
// database. A value such as "abc" or "1 OR 1=1" is stopped here with a clear
// 400 message instead of causing a database error (HTTP 500).
// The queries are already parameterised, so this is defence in depth and
// also keeps the error log clean.

const ID_PARAMS = ['id', 'studentId', 'gradeLevelId', 'sectionId', 'teacherId'];

function checkId(req, res, next, value) {
  // 1 to 9 digits always fits a PostgreSQL integer column.
  if (!/^[0-9]{1,9}$/.test(String(value))) {
    return res.status(400).json({ message: 'That ID is not valid.' });
  }
  next();
}

function checkDocType(req, res, next, value) {
  if (!/^[a-z0-9_]{1,40}$/.test(String(value))) {
    return res.status(400).json({ message: 'That document type is not valid.' });
  }
  next();
}

// Call once per router: protectParams(router);
function protectParams(router) {
  for (const name of ID_PARAMS) router.param(name, checkId);
  router.param('docType', checkDocType);
  return router;
}

module.exports = { protectParams };
