// src/repositories/urlCache.repository.js
//
// The only module allowed to talk to Redis for the redirect cache. Mirrors
// the role url.repository.js plays for PostgreSQL: services call these
// functions and never touch the Redis client directly.
//
// Cache key design: `url:<shortCode>` → the long URL as a plain string.
// The `url:` prefix namespaces this cache from other future uses of the
// same Redis server (rate-limit counters, BullMQ) so keys never collide,
// even though those other uses manage their own keys internally.
//
// FAIL-SAFE CONTRACT: every function here either returns a usable value
// or returns null/no-ops — it NEVER throws. A Redis outage must degrade
// the redirect path to "always miss, fall through to PostgreSQL", not
// break it. Every failure is logged server-side so it's visible in
// operations, per requirement #5.

const { redisClient, isRedisReady } = require('../config/redis');
const logger = require('../utils/logger');

const CACHE_KEY_PREFIX = 'url:';

// Configurable via env var (requirement #4). Defaults to 1 hour if unset.
const CACHE_TTL_SECONDS = Number(process.env.URL_CACHE_TTL_SECONDS) || 3600;

function cacheKey(shortCode) {
  return `${CACHE_KEY_PREFIX}${shortCode}`;
}

/**
 * CACHE-ASIDE READ STEP.
 *
 * Attempts to read the long URL for a short code from Redis.
 *   - Returns the cached long URL string on a CACHE HIT.
 *   - Returns null on a CACHE MISS (key not present) — this is the
 *     normal, expected "not cached yet" case, not an error.
 *   - Also returns null (instead of throwing) if Redis is unreachable
 *     or errors — the caller (the service) treats this exactly like a
 *     miss and falls through to PostgreSQL. This is what makes Redis
 *     unavailability non-fatal to redirects.
 */
async function getCachedLongUrl(shortCode) {
  if (!isRedisReady()) {
    // Fail fast: don't even attempt the command if we already know
    // Redis isn't connected — avoids waiting on a command that would
    // just fail anyway.
    return null;
  }

  try {
    const value = await redisClient.get(cacheKey(shortCode));
    return value; // null if the key doesn't exist (real cache miss)
  } catch (err) {
    logger.error('[redis] GET failed, falling back to PostgreSQL:', err.message);
    return null;
  }
}

/**
 * CACHE-ASIDE WRITE STEP ("cache population").
 *
 * Called only AFTER a successful PostgreSQL lookup (cache miss path) —
 * never for a short code that didn't resolve to a real row (requirement
 * #6: never cache failed lookups). Best-effort: if this fails, the
 * redirect still succeeds using the value already fetched from
 * PostgreSQL; the failure is just logged, not surfaced to the caller.
 */
async function setCachedLongUrl(shortCode, longUrl) {
  if (!isRedisReady()) {
    return;
  }

  try {
    await redisClient.set(cacheKey(shortCode), longUrl, { EX: CACHE_TTL_SECONDS });
  } catch (err) {
    logger.error('[redis] SET failed (redirect still succeeds via PostgreSQL):', err.message);
  }
}

/**
 * CACHE EVICTION. Called after a URL is deleted from PostgreSQL so the
 * short code stops redirecting immediately instead of continuing to be
 * served from Redis until its TTL expires.
 *
 * Same fail-safe contract as the other functions: never throws. If Redis
 * is down at this moment the eviction is skipped (and logged), and the
 * stale entry lives until its TTL runs out. That bounded staleness is
 * the accepted trade-off of a best-effort cache.
 */
async function deleteCachedLongUrl(shortCode) {
  if (!isRedisReady()) {
    logger.error(
      `[redis] Skipping cache eviction for "${shortCode}" (Redis unavailable); entry expires via TTL`
    );
    return;
  }

  try {
    await redisClient.del(cacheKey(shortCode));
  } catch (err) {
    logger.error('[redis] DEL failed (stale entry will expire via TTL):', err.message);
  }
}

module.exports = {
  getCachedLongUrl,
  setCachedLongUrl,
  deleteCachedLongUrl,
  CACHE_TTL_SECONDS,
};
