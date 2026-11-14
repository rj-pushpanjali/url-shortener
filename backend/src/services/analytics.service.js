// src/services/analytics.service.js
//
// Click analytics business logic, used by BOTH processes:
//   - web server:     trackClick() (producer) and getUrlAnalytics() (read API)
//   - worker process: processClickEvent() (consumer)

const AppError = require('../utils/AppError');
const analyticsRepository = require('../repositories/analytics.repository');
const { enqueueClickEvent } = require('../queues/clickEvent.queue');

const RECENT_CLICKS_LIMIT = 20;

/**
 * Called by the redirect handler once a short code has resolved.
 *
 * Deliberately NOT awaited by the caller and returns nothing: the
 * redirect must not wait on analytics. enqueueClickEvent never rejects,
 * so there is no unhandled-rejection risk.
 */
function trackClick(shortCode) {
  enqueueClickEvent(shortCode);
}

/**
 * Called by the worker for each job. Writes the click to PostgreSQL.
 * Throws on unexpected failures so BullMQ retries; returns
 * { recorded: false } for a URL that no longer exists.
 *
 * Delivery is AT-LEAST-ONCE: if the worker crashes after the database
 * commit but before BullMQ is told the job finished, the job runs again
 * and that click is counted twice. For a click counter that tiny
 * over-count is an accepted trade-off; exactly-once would need
 * de-duplication (e.g. a unique event id per click) that this project
 * deliberately doesn't add.
 */
async function processClickEvent({ shortCode, clickedAt }) {
  const urlId = await analyticsRepository.recordClick(shortCode, clickedAt);
  return { recorded: urlId !== null, urlId };
}

/**
 * Analytics for one of the caller's own URLs. A URL that doesn't exist and
 * one that belongs to someone else both give 404.
 */
async function getUrlAnalytics(id, userId) {
  const urlId = id; // already validated by validate.middleware.js (digits only)

  const stats = await analyticsRepository.findStatsForUser(urlId, userId);
  if (!stats) {
    throw new AppError(404, 'URL not found');
  }

  const recent = await analyticsRepository.findRecentClicks(urlId, RECENT_CLICKS_LIMIT);

  return {
    id: stats.id,
    shortCode: stats.short_code,
    longUrl: stats.long_url,
    totalClicks: Number(stats.total_clicks), // BIGINT string -> number (counts stay small)
    lastClickedAt: stats.last_clicked_at,
    recentClicks: recent.map((row) => row.clicked_at),
  };
}

module.exports = { trackClick, processClickEvent, getUrlAnalytics };
