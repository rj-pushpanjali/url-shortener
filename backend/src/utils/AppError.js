// src/utils/AppError.js
//
// A minimal typed error for expected, "safe to show the client" failures
// (e.g. validation errors). Anything thrown as a plain Error (e.g. a raw
// `pg` error) is treated as unexpected and gets a generic 500 message
// instead — see middleware/errorHandler.middleware.js. This is how the
// app avoids leaking PostgreSQL internals to clients without needing a
// full error-handling framework at this stage.

class AppError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.isAppError = true;
  }
}

module.exports = AppError;
