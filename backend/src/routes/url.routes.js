// src/routes/url.routes.js
//
// Routes for the /api/urls resource. Every route here requires a valid
// JWT: router.use(authenticate) applies the middleware to everything
// below it, so a new route can't accidentally be left unprotected.

const express = require('express');
const authenticate = require('../middleware/auth.middleware');
const { createUrl, listUrls, deleteUrl } = require('../controllers/url.controller');
const { getUrlAnalytics } = require('../controllers/analytics.controller');
const { apiLimiter, createUrlLimiter } = require('../middleware/rateLimiter.middleware');
const validate = require('../middleware/validate.middleware');
const { createUrlSchema, idParamSchema } = require('../validators/url.schema');

const router = express.Router();

router.use(authenticate);
// After authenticate on purpose: the limiter keys on req.user.id, so
// people sharing an IP (office, university) don't use up each other's budget.
router.use(apiLimiter);

router.post('/', createUrlLimiter, validate(createUrlSchema), createUrl);
router.get('/', listUrls);
router.delete('/:id', validate(idParamSchema, 'params'), deleteUrl);
router.get('/:id/analytics', validate(idParamSchema, 'params'), getUrlAnalytics);

module.exports = router;
