// src/controllers/url.controller.js
//
// HTTP layer only: parses the request, calls the service, shapes the
// response. No SQL, no business rules here.
//
// STAGE 5: the temporary Stage 3 user stand-in is gone. Protected
// handlers read the authenticated user's id from req.user.id, which the
// authenticate middleware sets after verifying the JWT.

const urlService = require('../services/url.service');
const analyticsService = require('../services/analytics.service');
const { buildShortUrl } = require('../utils/buildShortUrl');
const { SHORT_CODE_REGEX } = require('../validators/url.schema');

/**
 * POST /api/urls   (authenticated)
 */
async function createUrl(req, res, next) {
  try {
    const { longUrl } = req.body || {};

    const result = await urlService.createShortUrl(longUrl, req.user.id);

    res.status(201).json({
      success: true,
      data: {
        id: result.id,
        shortCode: result.shortCode,
        shortUrl: buildShortUrl(result.shortCode),
        longUrl: result.longUrl,
        createdAt: result.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/urls   (authenticated) - the caller's own URLs only
 */
async function listUrls(req, res, next) {
  try {
    const urls = await urlService.listUserUrls(req.user.id);

    res.status(200).json({
      success: true,
      data: urls.map((u) => ({ ...u, shortUrl: buildShortUrl(u.shortCode) })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/urls/:id   (authenticated) - only the caller's own URL
 */
async function deleteUrl(req, res, next) {
  try {
    await urlService.deleteUserUrl(req.params.id, req.user.id);

    res.status(200).json({ success: true, message: 'URL deleted' });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /:code   (public)
 *
 * Looks up the short code (Redis first, PostgreSQL on a miss), queues a
 * click event, and issues a 302 redirect. Unknown codes get a 404 JSON
 * body instead.
 */
async function redirectToLongUrl(req, res, next) {
  try {
    const { code } = req.params;

    // Not a possible short code (wrong characters or too long): 404 right
    // away, with no Redis or PostgreSQL lookup and no click queued.
    if (!SHORT_CODE_REGEX.test(code)) {
      return res.status(404).json({ success: false, message: 'Short URL not found' });
    }

    const longUrl = await urlService.getOriginalUrl(code);

    if (!longUrl) {
      // Unknown code: nothing to count, so no analytics job is queued.
      return res.status(404).json({
        success: false,
        message: 'Short URL not found',
      });
    }

    // Queue the click for the background worker. NOT awaited: the redirect
    // must not wait on analytics, and a queue failure must not affect it
    // (trackClick never throws). Express also answers HEAD requests through
    // GET routes, and a HEAD is not a real visit, so it isn't counted.
    if (req.method !== 'HEAD') {
      analyticsService.trackClick(code);
    }

    res.redirect(302, longUrl);
  } catch (err) {
    next(err);
  }
}

module.exports = { createUrl, listUrls, deleteUrl, redirectToLongUrl };
