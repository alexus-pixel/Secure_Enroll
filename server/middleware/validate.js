/**
 * Wraps a zod schema as Express middleware. Validates req.body (or
 * req.query / req.params, if told to) BEFORE the request reaches
 * any controller or touches the database — every admin write in
 * this codebase goes through this, so a controller never has to
 * re-check "is this actually a number" by hand.
 *
 * On failure it returns 400 with a flat list of field-level
 * messages, not the raw zod error object, so the client doesn't
 * need to know anything about zod's internal shape.
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || source,
        message: issue.message,
      }));
      return res.status(400).json({ message: 'Validation failed.', errors });
    }
    req[source] = result.data;
    next();
  };
}

module.exports = { validate };
