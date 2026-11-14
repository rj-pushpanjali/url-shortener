// src/config/redis.js
//
// Creates and exports a single shared Redis client, the same pattern as
// config/db.js for PostgreSQL — every other module imports the client
// from here rather than creating its own connection (requirement #8).
//
// WHY REDIS: URL shorteners are read-heavy (Section 9 of the approved
// architecture) — the same popular short codes get requested repeatedly.
// Redis lets those redirects be served from memory instead of hitting
// PostgreSQL on every single request.
//
// WHY POSTGRESQL REMAINS THE SOURCE OF TRUTH: Redis here is purely a
// cache-aside layer — a fast, disposable lookup table. It is never
// written to directly by a client request; it is only ever populated
// FROM a PostgreSQL read. If Redis lost all its data right now, the
// application would keep working correctly (just slower, hitting
// PostgreSQL every time) — nothing would be lost, because PostgreSQL
// always has the authoritative row.
//
// FAIL-SAFE BY DESIGN: this module must never let a Redis outage crash
// the app or block a redirect. That means:
//   - the 'error' event is always handled (an unhandled 'error' event on
//     a Node EventEmitter would otherwise crash the process)
//   - connection is attempted once at startup, not awaited by anything
//     that must succeed
//   - isRedisReady() lets callers (the cache repository) check
//     connection state BEFORE attempting a command, so a down Redis
//     fails fast (falls back to Postgres) instead of hanging

const { createClient } = require('redis');
const logger = require('../utils/logger');

const redisUrl =
  process.env.REDIS_URL ||
  `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;

const redisClient = createClient({ url: redisUrl });

// Tracks connection health so other modules can check readiness without
// awaiting a command. Updated only via these event handlers.
let redisReady = false;

redisClient.on('error', (err) => {
  // This is the critical fail-tolerance line: Redis being down or erroring
  // is logged, never thrown, and never crashes the process.
  redisReady = false;
  logger.error('[redis] Client error (cache will be bypassed):', err.message);
});

redisClient.on('connect', () => {
  logger.info('[redis] Connecting...');
});

redisClient.on('ready', () => {
  redisReady = true;
  logger.info('[redis] Connected and ready.');
});

redisClient.on('end', () => {
  redisReady = false;
  logger.info('[redis] Connection closed.');
});

// Kick off the connection once at module load (startup), not per-request.
// Deliberately not awaited here and wrapped in try/catch: if this fails,
// the 'error' handler above logs it, redisReady stays false, and the app
// continues starting up normally — Redis is an optional accelerator, not
// a hard dependency (requirement #9).
(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    logger.error('[redis] Initial connection attempt failed:', err.message);
  }
})();

/**
 * Synchronous readiness check — no network call. Used by the cache
 * repository to decide whether to even attempt a Redis command.
 */
function isRedisReady() {
  return redisReady && redisClient.isOpen;
}

/**
 * Active connectivity check used by GET /health. Unlike isRedisReady(),
 * this actually pings Redis, so health reporting reflects the current
 * state rather than the last known event. Never throws — returns false
 * on any failure.
 */
async function checkRedisConnection() {
  try {
    if (!redisClient.isOpen) return false;
    await redisClient.ping();
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = { redisClient, isRedisReady, checkRedisConnection };
