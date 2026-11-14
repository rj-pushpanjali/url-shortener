// src/queues/clickEvent.worker.js
//
// CONSUMER side of click analytics. This is a SEPARATE PROCESS from the web
// server:
//     npm start        -> web server (producer)
//     npm run worker   -> this file (consumer)
// Both use the same codebase and the same Redis and PostgreSQL. Running it
// separately means slow or failing database writes can never slow down or
// crash redirects, and the worker can be restarted or scaled on its own.
//
// What the worker does per job:
//   1. Validate the payload.
//   2. Insert a click_events row and update url_stats (one transaction).
//
// If the worker is down, clicks are NOT lost: jobs wait in Redis and are
// processed when it starts again.
//
// FAILURE HANDLING:
//   - Transient error (e.g. PostgreSQL briefly down): processJob throws,
//     BullMQ retries (3 attempts, exponential backoff, set in the queue's
//     defaultJobOptions). After the last attempt the job moves to the
//     "failed" set in Redis and is logged here.
//   - Permanent problem (malformed payload): UnrecoverableError makes
//     BullMQ fail the job immediately with no retries, since retrying
//     can't fix bad data.
//   - URL deleted before the job ran: not an error. The job completes and
//     is skipped.

require('dotenv').config();

const { Worker, UnrecoverableError } = require('bullmq');
const { QUEUE_NAME, buildWorkerConnection } = require('../config/bullmq');
const analyticsService = require('../services/analytics.service');
const logger = require('../utils/logger');

/**
 * Processes one click job. Exported separately from the Worker bootstrap
 * below so it can be tested without a running BullMQ/Redis.
 */
async function processJob(job) {
  const { shortCode, clickedAt } = job.data || {};

  const validCode = typeof shortCode === 'string' && shortCode.length > 0 && shortCode.length <= 64;
  const validTime = typeof clickedAt === 'string' && !Number.isNaN(Date.parse(clickedAt));
  if (!validCode || !validTime) {
    throw new UnrecoverableError('Invalid click event payload');
  }

  const result = await analyticsService.processClickEvent({ shortCode, clickedAt });

  if (!result.recorded) {
    logger.info(`[worker] Skipped click for "${shortCode}" (URL no longer exists)`);
  }
  return result;
}

function startWorker() {
  // Required here (not at the top) so merely importing processJob, as the
  // tests do, doesn't open a database pool.
  const { pool, testConnection } = require('../config/db');

  const concurrency = Number(process.env.WORKER_CONCURRENCY) || 5;

  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: buildWorkerConnection(),
    concurrency, // how many jobs this process works on at once
  });

  worker.on('ready', () => logger.info(`[worker] Listening on queue "${QUEUE_NAME}" (concurrency ${concurrency})`));

  worker.on('completed', (job) => {
    logger.info(`[worker] Job ${job.id} done`);
  });

  worker.on('failed', (job, err) => {
    // Fires on every failed attempt. attemptsMade vs opts.attempts tells
    // you whether a retry is coming or the job is now permanently failed.
    const attempts = job?.opts?.attempts ?? 1;
    const willRetry = job && job.attemptsMade < attempts && err.name !== 'UnrecoverableError';
    logger.error(
      `[worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}/${attempts}, ` +
        `${willRetry ? 'will retry' : 'giving up'}): ${err.message}`,
      willRetry ? '' : { data: job?.data }
    );
  });

  // Without this, a Redis connection error would be an unhandled
  // EventEmitter error and crash the worker.
  worker.on('error', (err) => {
    logger.error('[worker] Worker error:', err.message);
  });

  testConnection()
    .then(() => logger.info('[postgres] Worker database connection verified.'))
    .catch((err) => logger.error('[postgres] Worker cannot reach PostgreSQL yet:', err.message));

  // Graceful shutdown: worker.close() lets jobs already running finish
  // instead of abandoning them mid-write, then we release the database.
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[worker] ${signal} received, finishing active jobs...`);

    const forceExit = setTimeout(() => {
      logger.error('[worker] Shutdown timed out, forcing exit.');
      process.exit(1);
    }, 10000);
    forceExit.unref();

    try {
      await worker.close();
      await pool.end();
      logger.info('[worker] Shut down cleanly.');
      process.exit(0);
    } catch (err) {
      logger.error('[worker] Error during shutdown:', err.message);
      process.exit(1);
    }
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { worker, shutdown };
}

// Start only when run directly (npm run worker), not when required by a test.
if (require.main === module) {
  startWorker();
}

module.exports = { processJob, startWorker };
