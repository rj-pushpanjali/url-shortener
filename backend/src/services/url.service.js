// src/services/url.service.js
//
// Business logic layer. Knows about "creating a short URL" and "resolving
// a redirect" as concepts — it does not know about HTTP (req/res) and does
// not write SQL directly (that's the repository's job).

const base62 = require('../utils/base62');
const AppError = require('../utils/AppError');
const urlRepository = require('../repositories/url.repository');
const urlCacheRepository = require('../repositories/urlCache.repository');
const { cacheLookups } = require('../utils/metrics');

/**
 * Creates a new short URL for the given long URL and owning user.
 *
 * Flow (approved design):
 *   1. Validate the long URL.
 *   2. Pull the next value from the url_mapping sequence (numeric ID) —
 *      BEFORE inserting anything.
 *   3. Base62-encode that ID into a short_code.
 *   4. Insert id + short_code + long_url together, in a single INSERT.
 *
 * This avoids ever having a row with a null/placeholder short_code, and
 * avoids any random-generation + collision-retry logic: the ID (and
 * therefore the short_code derived from it) is guaranteed unique by the
 * PostgreSQL sequence itself.
 */
async function createShortUrl(longUrl, userId) {
  const nextId = await urlRepository.getNextId(); // string, e.g. "125" (BIGINT)
  const shortCode = base62.encode(nextId);

  let row;
  try {
    row = await urlRepository.insertUrlMapping({
      id: nextId,
      userId,
      shortCode,
      longUrl,
    });
  } catch (err) {
    // 23503 = foreign_key_violation on user_id: the JWT is still valid but
    // the account was deleted. Tell the client to sign in again (a 401 makes
    // the frontend log out) instead of leaking a generic 500.
    if (err.code === '23503') {
      throw new AppError(401, 'Account no longer exists');
    }
    throw err;
  }

  return {
    id: row.id,
    shortCode: row.short_code,
    longUrl: row.long_url,
    createdAt: row.created_at,
  };
}

/**
 * Resolves a short_code to its original long_url for the redirect route.
 * Returns null if the code doesn't exist — the controller turns that
 * into a 404.
 *
 * STAGE 4 — CACHE-ASIDE PATTERN:
 *
 *   GET /:code
 *       ↓
 *   Redis GET "url:<code>"
 *       ↓
 *    ┌──┴──┐
 *    ↓     ↓
 *   HIT   MISS
 *    ↓     ↓
 *  return  PostgreSQL lookup
 *  cached      ↓
 *  value    found? ── no ──→ return null (404, NOT cached — requirement #6)
 *              ↓ yes
 *          Redis SET "url:<code>" (best-effort, with TTL)
 *              ↓
 *          return long_url
 *
 * CACHE HIT: the value already exists in Redis — we skip PostgreSQL
 * entirely and return immediately. This is the whole point of caching a
 * read-heavy path: the common case (a popular short code being clicked
 * again) never touches the database.
 *
 * CACHE MISS: Redis has no entry for this code yet (first time it's been
 * requested, or its TTL expired). We fall back to PostgreSQL — the
 * source of truth — fetch the row, and if found, populate Redis so the
 * NEXT request for this code is a hit. This "populate on miss" step is
 * what makes it "cache-ASIDE": the cache sits beside the read path and
 * is filled lazily, rather than being kept in sync proactively.
 *
 * WHY POSTGRESQL REMAINS THE SOURCE OF TRUTH: Redis is only ever
 * populated as a side effect of a successful PostgreSQL read. We never
 * write directly to Redis in response to a client request that isn't
 * itself backed by a PostgreSQL row. If the cache is cleared or a key
 * expires, the exact same data is reconstructible from PostgreSQL — no
 * data exists in Redis that doesn't also exist there.
 *
 * REDIS UNAVAILABLE: getCachedLongUrl() and setCachedLongUrl() (in
 * urlCache.repository.js) never throw — a Redis outage makes every
 * lookup behave as a miss, and every cache-population attempt silently
 * no-ops. This function doesn't need its own try/catch around the cache
 * calls as a result: redirects keep working through PostgreSQL alone,
 * just without the speed benefit, exactly as required.
 */
async function getOriginalUrl(shortCode) {
  // 1. Try the cache first.
  const cachedLongUrl = await urlCacheRepository.getCachedLongUrl(shortCode);
  if (cachedLongUrl !== null) {
    // CACHE HIT — return immediately, no PostgreSQL query needed.
    cacheLookups.inc({ result: 'hit' });
    return cachedLongUrl;
  }

  // 2. CACHE MISS — fall back to PostgreSQL, the source of truth.
  cacheLookups.inc({ result: 'miss' });
  const row = await urlRepository.findByShortCode(shortCode);
  if (!row) {
    // Not found in PostgreSQL either — genuinely doesn't exist.
    // Deliberately NOT cached (requirement #6: never cache negative
    // results), so a typo'd code doesn't occupy cache space, and a code
    // that gets created moments later isn't shadowed by a stale "miss".
    return null;
  }

  // 3. Populate the cache for next time (cache population / "SET").
  // Best-effort — failures here are logged inside the repository and do
  // not affect this request's outcome.
  await urlCacheRepository.setCachedLongUrl(shortCode, row.long_url);

  return row.long_url;
}

/**
 * Returns all URLs owned by the given user (the dashboard list).
 */
async function listUserUrls(userId) {
  const rows = await urlRepository.findAllByUserId(userId);
  return rows.map((row) => ({
    id: row.id,
    shortCode: row.short_code,
    longUrl: row.long_url,
    // BIGINT arrives from pg as a string. A click count will not
    // approach 2^53, so Number() is safe here (unlike ids, which stay
    // strings).
    totalClicks: Number(row.total_clicks),
    createdAt: row.created_at,
  }));
}

/**
 * Deletes one of the user's own URLs.
 *
 * Authorization lives in the SQL (WHERE id = $1 AND user_id = $2). If
 * nothing matches we return 404 whether the URL doesn't exist or belongs
 * to someone else, so the API never confirms that another user's URL id
 * exists.
 *
 * Order matters: delete from PostgreSQL (source of truth) FIRST, then
 * evict from Redis. The reverse order could let a concurrent redirect
 * re-populate the cache from a row that is about to be deleted.
 */
async function deleteUserUrl(id, userId) {
  // id is already validated (digits only) by validate.middleware.js.
  const deleted = await urlRepository.deleteByIdAndUserId(id, userId);
  if (!deleted) {
    throw new AppError(404, 'URL not found');
  }

  await urlCacheRepository.deleteCachedLongUrl(deleted.short_code);
}

module.exports = { createShortUrl, getOriginalUrl, listUserUrls, deleteUserUrl };
