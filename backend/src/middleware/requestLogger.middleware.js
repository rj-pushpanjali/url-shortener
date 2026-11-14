// src/middleware/requestLogger.middleware.js
//
// One structured log line per finished request:
//   {"level":"info","msg":"request","requestId":"...","method":"GET",
//    "path":"/abc","status":302,"durationMs":3.1,...}
//
// /health and /metrics are skipped (probes would drown everything else).
// The query string is never logged. 5xx is logged at error level.
// Under heavy load set LOG_LEVEL=warn to silence the per-request lines.

const logger = require('../utils/logger');

const SKIP = new Set(['/health', '/metrics']);

function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0];
    if (SKIP.has(path)) return;

    const fields = {
      requestId: req.id,
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Math.round((Number(process.hrtime.bigint() - start) / 1e6) * 100) / 100,
      ip: req.ip,
    };
    if (res.statusCode >= 500) logger.error('request', fields);
    else logger.info('request', fields);
  });

  next();
}

module.exports = requestLogger;
