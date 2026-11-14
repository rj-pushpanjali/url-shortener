// src/routes/health.routes.js
//
// Basic liveness/readiness endpoint.
// Kept as its own route module (rather than inline in server.js) so that
// later stages (Docker healthchecks, Nginx upstream checks) have a stable,
// dedicated place to extend it.
//
// STAGE 4: now also reports Redis connectivity. IMPORTANT — per
// requirement #9, Redis is NOT a hard requirement for this endpoint (or
// for redirects). PostgreSQL is: if PostgreSQL is unreachable, nothing
// in this app can function (no URLs can be created or resolved at all),
// so that still returns 503. Redis being down only means redirects fall
// back to PostgreSQL for every request — the app is degraded, not
// broken — so a Redis outage alone does NOT flip this endpoint to 503.

const express = require('express');
const { testConnection } = require('../config/db');
const { checkRedisConnection } = require('../config/redis');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/health', async (req, res) => {
  const redisConnected = await checkRedisConnection(); // never throws

  try {
    await testConnection();
    res.status(200).json({
      success: true,
      message: 'OK',
      db: 'connected',
      redis: redisConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[health] Database check failed:', err.message);
    res.status(503).json({
      success: false,
      message: 'Service unavailable',
      db: 'disconnected',
      redis: redisConnected ? 'connected' : 'disconnected',
    });
  }
});

module.exports = router;
