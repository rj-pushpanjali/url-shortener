// src/queues/clickEvent.queue.js
//
// PRODUCER side of click analytics. The redirect handler calls
// enqueueClickEvent() and moves on; it never waits for the job to be
// PROCESSED, and a queue failure never fails or delays a redirect.
//
// WHY A QUEUE: a redirect is the latency-critical path a real person is
// waiting on. Writing a click_events row plus a url_stats update is two
// database writes that the person doesn't need to wait for. We hand the
// work to Redis (very fast), respond with the 302 immediately, and a
// separate worker process does the database writes in the background.
//
// FAIL-SAFE CONTRACT (same philosophy as the Redis cache in Stage 4):
// enqueueClickEvent() NEVER throws and NEVER rejects. If Redis is down,
// that click is simply not counted and the failure is logged. Analytics
// are best-effort; redirects are not.

const { Queue } = require('bullmq');
const { QUEUE_NAME, buildQueueConnection } = require('../config/bullmq');
const logger = require('../utils/logger');
const { clicksEnqueued, clicksDropped } = require('../utils/metrics');

const clickQueue = new Queue(QUEUE_NAME, {
  connection: buildQueueConnection(),
  defaultJobOptions: {
    // If the worker throws (e.g. PostgreSQL briefly unavailable), retry up
    // to 3 times in total, waiting 1s then 2s between attempts
    // (exponential backoff). Each failure is retried by a worker later;
    // it does NOT block redirects.
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    // Don't let finished jobs pile up in Redis forever. click_events in
    // PostgreSQL is the permanent record, so completed jobs can go.
    removeOnComplete: true,
    // Keep the most recent failures so they can be inspected (they sit in
    // the "failed" set in Redis) rather than vanishing silently.
    removeOnFail: { count: 1000 },
  },
});

// Without an 'error' listener, a Redis connection error on this object
// would be an unhandled EventEmitter error and crash the web server.
clickQueue.on('error', (err) => {
  logger.error('[queue] Click queue error (analytics may be skipped):', err.message);
});

// With the offline queue disabled, add() fails fast while Redis is down.
// But if a connection is half-dead rather than cleanly down, add() could
// hang instead of failing, and every redirect would leave a pending
// promise behind. Capping in-flight enqueues bounds that memory: past the
// cap we drop the click and log, instead of growing without limit.
const MAX_IN_FLIGHT = 200;
let inFlight = 0;
let droppedCount = 0;

/**
 * Queues one click for background processing. Returns a promise that
 * ALWAYS resolves (true if queued, false if dropped/failed), so callers
 * may safely ignore it ("fire and forget") without risking an unhandled
 * rejection.
 *
 * The job carries the short CODE rather than the numeric id: on a cache
 * hit the redirect path only knows the code (the cache stores code ->
 * long URL), and the worker is the right place to resolve code -> id, off
 * the request path.
 */
async function enqueueClickEvent(shortCode) {
  if (inFlight >= MAX_IN_FLIGHT) {
    droppedCount += 1;
    clicksDropped.inc({ reason: 'too_many_pending' });
    if (droppedCount % 100 === 1) {
      logger.error(`[queue] Too many pending enqueues; dropping clicks (dropped so far: ${droppedCount})`);
    }
    return false;
  }

  inFlight += 1;
  try {
    await clickQueue.add('click', {
      shortCode,
      clickedAt: new Date().toISOString(),
    });
    clicksEnqueued.inc();
    return true;
  } catch (err) {
    logger.error('[queue] Failed to enqueue click event (redirect unaffected):', err.message);
    clicksDropped.inc({ reason: 'enqueue_failed' });
    return false;
  } finally {
    inFlight -= 1;
  }
}

module.exports = { clickQueue, enqueueClickEvent };
