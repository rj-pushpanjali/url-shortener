// src/middleware/rateLimiter.middleware.js
//
// Redis-backed rate limiting (express-rate-limit + rate-limit-redis).
//
// WHY REDIS AND NOT NODE MEMORY: express-rate-limit's default store keeps
// counters in the Node process's memory. With three backend instances
// behind Nginx (Stage 10/11) a client could make `limit` requests to EACH
// instance, so the real limit would be 3x what we configured. Here the
// counters live in the shared Redis server, so every instance reads and
// increments the same number. That is the whole point of this stage.
//
// HOW IT WORKS: for each request we build a key (usually the client IP, or
// the user id once authenticated), and the store atomically increments a
// Redis counter named  rl:<limiter>:<key>  that expires after the window
// (a "fixed window" counter). Over the limit -> HTTP 429.
//
// Each limiter gets its OWN store instance and key prefix. Sharing one
// prefix would make every limiter count the same client in the same
// counter (a login attempt would eat into the redirect budget).
//
// FAILURE POLICY: FAIL OPEN. If Redis is unavailable we let requests
// through unlimited rather than blocking them. Redis is already treated as
// optional for redirects (Stage 4) and analytics (Stage 7); a Redis outage
// must not also lock everyone out of logging in. The cost: while Redis is
// down, brute-force protection on /auth/login is off. That is an explicit
// trade-off (availability over strictness), documented in the README.
//
// The limits and the reasoning behind each are in the README.

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const rateLimitRedis = require('rate-limit-redis');
const { redisClient, isRedisReady } = require('../config/redis');
const logger = require('../utils/logger');
const { rateLimited } = require('../utils/metrics');

// Works whether the package exposes RedisStore as a named, default or
// direct CommonJS export.
const RedisStore = rateLimitRedis.RedisStore || rateLimitRedis.default || rateLimitRedis;

const MINUTE = 60 * 1000;

// Positive-integer env override, else the default. Lets you lower a limit
// for a demo or test (e.g. RATE_LIMIT_LOGIN_MAX=3) without touching code.
function envLimit(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// Evaluated when this module loads (after dotenv, as server.js requires
// routes later).
const LIMITS = {
  register: {
    windowMs: 60 * MINUTE,
    limit: envLimit('RATE_LIMIT_REGISTER_MAX', 5),
    message: 'Too many accounts created from this address. Please try again later.',
  },
  login: {
    windowMs: 15 * MINUTE,
    limit: envLimit('RATE_LIMIT_LOGIN_MAX', 10),
    message: 'Too many failed login attempts. Please try again in a few minutes.',
    skipSuccessfulRequests: true, // only failed attempts (status >= 400) use up the budget
  },
  createUrl: {
    windowMs: MINUTE,
    limit: envLimit('RATE_LIMIT_CREATE_URL_MAX', 30),
    message: 'You are creating short URLs too quickly. Please slow down.',
    perUser: true,
  },
  api: {
    windowMs: MINUTE,
    limit: envLimit('RATE_LIMIT_API_MAX', 120),
    message: 'Too many requests. Please slow down.',
    perUser: true,
  },
  redirect: {
    windowMs: MINUTE,
    limit: envLimit('RATE_LIMIT_REDIRECT_MAX', 300),
    message: 'Too many requests. Please try again shortly.',
  },
};

// Authenticated routes are limited per USER (so people behind one shared
// IP don't eat each other's budget); everything else per client IP.
// ipKeyGenerator groups IPv6 addresses by /56 so one machine can't dodge
// the limit by rotating addresses inside its own range.
function keyByUserOrIp(req) {
  if (req.user && req.user.id) return `user:${req.user.id}`;
  return ipKeyGenerator(req.ip);
}

// Redis being down would otherwise log a line per request; log at most
// once every 30 seconds.
let lastOutageLog = 0;
function logOutageThrottled() {
  const now = Date.now();
  if (now - lastOutageLog > 30 * 1000) {
    lastOutageLog = now;
    logger.error('[rate-limit] Redis unavailable; rate limiting is OFF (failing open) until it returns');
  }
}

// How rate-limit-redis talks to our (node-redis) client. It refuses
// immediately when Redis isn't ready instead of letting node-redis queue
// the command and make the request wait for a reconnect.
function sendCommand(...args) {
  if (!isRedisReady()) {
    return Promise.reject(new Error('Redis is not ready'));
  }
  return redisClient.sendCommand(args);
}

function buildLimiter(name, config) {
  const store = new RedisStore({
    sendCommand,
    prefix: `rl:${name}:`,
  });

  // The store loads its Lua script as soon as it's constructed. If that
  // fails (Redis dropped in that instant) the rejected promise would be
  // "unhandled" and could crash Node. Mark both as handled; the store
  // reloads the script by itself on the next request.
  for (const prop of ['incrementScriptSha', 'getScriptSha']) {
    if (store[prop] && typeof store[prop].catch === 'function') {
      store[prop].catch(() => {});
    }
  }

  return rateLimit({
    windowMs: config.windowMs,
    limit: config.limit,
    standardHeaders: 'draft-7', // RateLimit + RateLimit-Policy headers (and Retry-After on a 429)
    legacyHeaders: false, // no X-RateLimit-* duplicates
    store,
    passOnStoreError: true, // second safety net: a store error mid-request lets it through
    skipSuccessfulRequests: Boolean(config.skipSuccessfulRequests),
    ...(config.perUser ? { keyGenerator: keyByUserOrIp } : {}),
    // Same JSON envelope as every other error. Answered directly rather
    // than through the error handler so an abusive client can't flood the
    // server log with one stack trace per rejected request.
    handler: (req, res, next, options) => {
      rateLimited.inc({ limiter: name });
      res.status(options.statusCode).json({ success: false, message: config.message });
    },
  });
}

/**
 * Returns Express middleware for one limiter.
 *
 * The real limiter is built LAZILY, the first time a request arrives while
 * Redis is ready, not at startup. Building it needs Redis (script load),
 * and Redis normally connects a few milliseconds after the server starts.
 * While Redis isn't ready we fail open.
 */
function createLimiter(name) {
  const config = LIMITS[name];
  let limiter = null;

  return function rateLimiterMiddleware(req, res, next) {
    if (!isRedisReady()) {
      logOutageThrottled();
      return next();
    }
    if (!limiter) {
      limiter = buildLimiter(name, config);
    }
    return limiter(req, res, next);
  };
}

module.exports = {
  registerLimiter: createLimiter('register'),
  loginLimiter: createLimiter('login'),
  createUrlLimiter: createLimiter('createUrl'),
  apiLimiter: createLimiter('api'),
  redirectLimiter: createLimiter('redirect'),
  // exported for tests/docs only
  LIMITS,
};
