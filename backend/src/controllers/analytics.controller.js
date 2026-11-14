// src/controllers/analytics.controller.js
//
// GET /api/urls/:id/analytics (authenticated). HTTP layer only.

const analyticsService = require('../services/analytics.service');

async function getUrlAnalytics(req, res, next) {
  try {
    const data = await analyticsService.getUrlAnalytics(req.params.id, req.user.id);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

module.exports = { getUrlAnalytics };
