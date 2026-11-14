// src/middleware/validate.middleware.js
//
// Generic request validation with a Zod schema.
//
//   router.post('/register', validate(registerSchema), register);
//   router.delete('/:id', validate(idParamSchema, 'params'), deleteUrl);
//
// On success the parsed (trimmed / normalised / unknown-keys-stripped) value
// REPLACES req[source], so controllers only ever see clean data. On failure
// it forwards an AppError(400) carrying the first, client-safe message from
// the schema, in the same JSON envelope as every other error.

const AppError = require('../utils/AppError');

function validate(schema, source = 'body') {
  return function validateMiddleware(req, res, next) {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const message = result.error.issues[0]?.message || 'Invalid request';
      return next(new AppError(400, message));
    }

    req[source] = result.data;
    return next();
  };
}

module.exports = validate;
