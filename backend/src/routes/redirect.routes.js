// src/routes/redirect.routes.js
//
// The catch-all GET /:code redirect route, kept in its own module
// specifically so server.js can register it LAST — after /health and
// /api/urls — per the approved route-ordering requirement. If this were
// registered before /health, Express would try to treat the literal path
// "health" as a short code and it would never reach the real health route.

const express = require('express');
const { redirectToLongUrl } = require('../controllers/url.controller');
const { redirectLimiter } = require('../middleware/rateLimiter.middleware');

const router = express.Router();

router.get('/:code', redirectLimiter, redirectToLongUrl);

module.exports = router;
