// src/server.js
//
// Application entrypoint. This same file runs in every backend container
// (backend1/backend2/backend3 behind Nginx). That works because the app is
// stateless: users (JWT), URLs (PostgreSQL), cache, rate-limit counters and
// the analytics queue all live OUTSIDE the process.
//
// IMPORTANT: GET /health and GET /metrics are registered BEFORE the
// catch-all GET /:code redirect route. If /:code were registered first,
// Express would match "GET /health" as if "health" were a short code, and
// the real route would never be reached.

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const { pool, testConnection } = require('./config/db');
const { redisClient } = require('./config/redis'); // also starts the Redis connection attempt at boot (non-blocking, see config/redis.js)
const healthRoutes = require('./routes/health.routes');
const metricsRoutes = require('./routes/metrics.routes');
const authRoutes = require('./routes/auth.routes');
const urlRoutes = require('./routes/url.routes');
const redirectRoutes = require('./routes/redirect.routes');
const errorHandler = require('./middleware/errorHandler.middleware');
const requestId = require('./middleware/requestId.middleware');
const metricsMiddleware = require('./middleware/metrics.middleware');
const requestLogger = require('./middleware/requestLogger.middleware');
const instanceHeader = require('./middleware/instanceHeader.middleware');
const parseTrustProxy = require('./utils/parseTrustProxy');
const { getBaseUrl } = require('./utils/buildShortUrl');
const logger = require('./utils/logger');

const app = express();

// Rate limits are keyed by client IP, so Express must know whether it sits
// behind a reverse proxy (Nginx). Off by default. See utils/parseTrustProxy.js
// for why this must be exact, never "true".
try {
  app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
} catch (err) {
  logger.error('[config]', err.message);
  process.exit(1);
}

// --- Middleware, in this order ---
app.use(requestId); //                 req.id + X-Request-Id, used by everything below
app.use(instanceHeader); //            X-Served-By, only when INSTANCE_NAME is set (demos)
app.use(helmet()); //                  security headers (also removes X-Powered-By)
app.use(metricsMiddleware); //         request count + duration for /metrics
app.use(requestLogger); //             one JSON log line per finished request
app.use(express.json({ limit: '100kb' }));

// --- Routes ---
// Order matters here:
//   1. /health, /metrics  — specific paths, must win over the /:code catch-all
//   2. /auth/*            — public register/login
//   3. /api/urls          — protected (JWT) URL management
//   4. /:code (redirect)  — catch-all, registered LAST on purpose
app.use('/', healthRoutes);
app.use('/', metricsRoutes);
app.use('/auth', authRoutes);
app.use('/api/urls', urlRoutes);
app.use('/', redirectRoutes);

// --- Centralized error handler ---
// Must be registered after all routes (Express convention: a 4-arg
// middleware function registered last is treated as the error handler).
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

let server = null;

async function start() {
  // Fail fast on missing/weak JWT config. Running without a real secret
  // would mean tokens signed with `undefined` or a guessable key.
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    logger.error('[config] JWT_SECRET must be set and at least 32 characters. See .env.example.');
    process.exit(1);
  }

  // Fail fast on a malformed public URL: every short link would be wrong.
  try {
    logger.info(`[server] Short links will use ${getBaseUrl()}`);
  } catch (err) {
    logger.error('[config]', err.message);
    process.exit(1);
  }

  try {
    await testConnection();
    logger.info('[postgres] Connection verified successfully.');
  } catch (err) {
    logger.error('[postgres] Failed to connect to PostgreSQL:', err.message);
    logger.error('[postgres] Server will still start, but /health will report db: disconnected until this is fixed.');
  }

  server = app.listen(PORT, () => {
    logger.info(`[server] ${process.env.INSTANCE_NAME || 'instance'} listening on port ${PORT}`);
    logger.info(`[server] Health check: http://localhost:${PORT}/health`);
  });
}

// Graceful shutdown (docker stop sends SIGTERM): stop accepting new
// connections, let in-flight requests finish, then release PostgreSQL, Redis
// and the BullMQ queue. Without this, a deploy or restart would cut requests
// off mid-flight. The timer is a safety net so a stuck connection can't block
// the exit forever.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`[server] ${signal} received, shutting down gracefully...`);

  const forceExit = setTimeout(() => {
    logger.error('[server] Graceful shutdown timed out, forcing exit.');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  try {
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeIdleConnections?.(); // keep-alive connections from nginx would otherwise hold close() open
      });
    }
    // Required here (not at the top) so the queue module isn't loaded just to be closed.
    const { clickQueue } = require('./queues/clickEvent.queue');
    await Promise.allSettled([clickQueue.close(), redisClient.isOpen ? redisClient.quit() : Promise.resolve(), pool.end()]);
    logger.info('[server] Shut down cleanly.');
    process.exit(0);
  } catch (err) {
    logger.error('[server] Error during shutdown:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  start();
}

module.exports = app;
