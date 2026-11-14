// src/middleware/errorHandler.middleware.js
//
// Centralized error handler. It does two things:
//   1. Log the real error server-side (structured, with the request id).
//   2. Send the client a safe JSON error: an AppError's own status/message,
//      a clean 400/413 for body-parser problems (bad JSON, body too big),
//      and a generic 500 with no internals for anything else (e.g. a raw
//      `pg` error, which could leak table/column names).
//
// Every error response carries requestId so a user can quote it in a report.

const logger = require('../utils/logger');

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const requestId = req.id;

  if (err.isAppError) {
    // Expected, client-caused: no stack trace needed.
    logger.warn('[error] request rejected', { requestId, statusCode: err.statusCode, reason: err.message });
    return res.status(err.statusCode).json({ success: false, message: err.message, requestId });
  }

  // express.json() failures. Without this, malformed JSON would be a 500.
  if (err.type === 'entity.parse.failed') {
    logger.warn('[error] malformed JSON body', { requestId });
    return res.status(400).json({ success: false, message: 'Request body is not valid JSON', requestId });
  }
  if (err.type === 'entity.too.large') {
    logger.warn('[error] request body too large', { requestId });
    return res.status(413).json({ success: false, message: 'Request body too large', requestId });
  }

  // Unexpected error: log everything, tell the client nothing.
  logger.error('[error] unexpected error', err, { requestId });
  return res.status(500).json({ success: false, message: 'Internal server error', requestId });
}

module.exports = errorHandler;
