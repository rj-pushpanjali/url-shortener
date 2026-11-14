// src/config/bullmq.js
//
// BullMQ connection settings, kept separate from config/redis.js on
// purpose. It is the same Redis SERVER, but a different client library
// with different needs: BullMQ uses ioredis internally, while the redirect
// cache uses node-redis. Each library gets the connection configuration
// that suits it (approved clarification #3).
//
// We pass plain option objects (not a shared client instance) so BullMQ
// creates and manages its own connections, tuned per role. The two roles
// need OPPOSITE behaviour when Redis is down (BullMQ production guide):
//
//   Queue  (producer, runs inside the web request path)
//          -> enableOfflineQueue: false. When Redis is unreachable,
//             queue.add() fails immediately instead of buffering commands
//             and waiting. A click event can be dropped; a redirect must
//             never wait.
//   Worker (consumer, its own process)
//          -> maxRetriesPerRequest: null. The worker should wait for Redis
//             to come back and keep going, not crash or give up.

const QUEUE_NAME = 'click-events';

// Same env vars as config/redis.js: REDIS_URL wins, else REDIS_HOST/PORT.
function parseRedisConnection() {
  const raw = process.env.REDIS_URL;

  if (raw) {
    const url = new URL(raw);
    const connection = {
      host: url.hostname,
      port: Number(url.port) || 6379,
    };
    if (url.username) connection.username = decodeURIComponent(url.username);
    if (url.password) connection.password = decodeURIComponent(url.password);
    if (url.pathname.length > 1) connection.db = Number(url.pathname.slice(1)) || 0;
    if (url.protocol === 'rediss:') connection.tls = {};
    return connection;
  }

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
  };
}

function buildQueueConnection() {
  return { ...parseRedisConnection(), enableOfflineQueue: false };
}

function buildWorkerConnection() {
  return { ...parseRedisConnection(), maxRetriesPerRequest: null };
}

module.exports = { QUEUE_NAME, buildQueueConnection, buildWorkerConnection };
