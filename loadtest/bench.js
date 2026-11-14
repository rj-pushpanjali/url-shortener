#!/usr/bin/env node
'use strict';
//
// loadtest/bench.js
//
// A small, dependency-free HTTP load generator (Node 18+, nothing to install)
// for measuring the running stack through Nginx.
//
//   node loadtest/bench.js                          # redirect, 10 s, 50 connections
//   node loadtest/bench.js --mode miss              # codes that don't exist (always PostgreSQL)
//   node loadtest/bench.js --mode health            # /health (checks PostgreSQL + Redis)
//   node loadtest/bench.js --duration 30 --connections 100
//   node loadtest/bench.js --code abc123            # reuse an existing short code
//
// MODES
//   redirect  GET /<code> for a real short code. After the first request the
//             answer comes from the Redis cache, so this measures the HOT path.
//             Every redirect also queues a click for the worker.
//   miss      GET /<random valid-looking code> that does not exist: Redis miss,
//             PostgreSQL lookup, 404. Never cached on purpose. Compare it with
//             `redirect` to see what the cache is worth.
//   health    GET /health.
//
// BEFORE YOU RUN IT: the default rate limits (300 redirects/min per IP) would
// answer almost everything with 429 and tell you nothing. Raise them and
// quieten the logs for the benchmark (put these in .env):
//     RATE_LIMIT_REDIRECT_MAX=100000000
//     RATE_LIMIT_REGISTER_MAX=1000
//     LOG_LEVEL=warn
//   docker compose up -d      # recreates the backends
//   docker compose restart nginx
// The script prints a warning if it sees 429s. Put the limits back afterwards.
//
// Redirects are NOT followed (a 302 is a success): the test measures this
// service, not the sites the short links point to.
//
// HOW TO READ THE NUMBERS: everything runs on ONE machine (load generator,
// nginx, 3 backends, Postgres, Redis share its CPU), so the figures show how
// this setup behaves on your hardware. They are not a capacity claim. Run it
// a few times and report a range or the median, with your hardware.

const http = require('node:http');
const crypto = require('node:crypto');

// ------------------------------------------------------------------ options

function parseArgs(argv) {
  const opts = {
    mode: 'redirect',
    base: process.env.BASE_URL || 'http://localhost:5000',
    duration: 10,
    connections: 50,
    warmup: 2,
    code: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[i];
    };
    if (arg === '--mode') opts.mode = next();
    else if (arg === '--base') opts.base = next();
    else if (arg === '--duration') opts.duration = Number(next());
    else if (arg === '--connections') opts.connections = Number(next());
    else if (arg === '--warmup') opts.warmup = Number(next());
    else if (arg === '--code') opts.code = next();
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!['redirect', 'miss', 'health'].includes(opts.mode)) throw new Error('--mode must be redirect, miss or health');
  for (const key of ['duration', 'connections', 'warmup']) {
    if (!Number.isFinite(opts[key]) || opts[key] < 0) throw new Error(`--${key} must be a non-negative number`);
  }
  if (opts.duration === 0 || opts.connections === 0) throw new Error('--duration and --connections must be above 0');
  return opts;
}

// ------------------------------------------------------------------ helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function percentile(sortedAscending, p) {
  if (sortedAscending.length === 0) return 0;
  const index = Math.min(sortedAscending.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAscending.length) - 1));
  return sortedAscending[index];
}

function summarize(latenciesMs, statusCounts, elapsedSeconds, errors) {
  const sorted = Float64Array.from(latenciesMs).sort();
  const total = latenciesMs.length;
  const sum = latenciesMs.reduce((a, b) => a + b, 0);
  return {
    requests: total,
    seconds: elapsedSeconds,
    requestsPerSecond: elapsedSeconds > 0 ? total / elapsedSeconds : 0,
    errors,
    statusCounts,
    latencyMs: {
      min: sorted[0] ?? 0,
      avg: total ? sum / total : 0,
      p50: percentile(sorted, 50),
      p90: percentile(sorted, 90),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: sorted[sorted.length - 1] ?? 0,
    },
  };
}

function request(agent, method, urlString, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        agent,
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers } : headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Registers a throwaway user, logs in and creates one short URL.
async function createTestUrl(base) {
  const agent = new http.Agent({ keepAlive: false });
  const email = `bench-${crypto.randomBytes(6).toString('hex')}@example.com`;
  const password = 'bench-password-123';

  const reg = await request(agent, 'POST', `${base}/auth/register`, { body: { name: 'Bench', email, password } });
  if (reg.status !== 201) {
    throw new Error(
      reg.status === 429
        ? 'Registration was rate limited (default 5 per hour per IP). Set RATE_LIMIT_REGISTER_MAX=1000 in .env, or pass --code <existing short code>.'
        : `Register failed: HTTP ${reg.status} ${reg.body}`
    );
  }
  const login = await request(agent, 'POST', `${base}/auth/login`, { body: { email, password } });
  if (login.status !== 200) throw new Error(`Login failed: HTTP ${login.status} ${login.body}`);
  const token = JSON.parse(login.body).data.token;

  const created = await request(agent, 'POST', `${base}/api/urls`, {
    headers: { Authorization: `Bearer ${token}` },
    body: { longUrl: 'https://example.com/benchmark-target' },
  });
  if (created.status !== 201) throw new Error(`Create URL failed: HTTP ${created.status} ${created.body}`);
  return JSON.parse(created.body).data.shortCode;
}

const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
function randomMissingCode() {
  // 10 random Base62 characters: a valid-looking code that is never in the database.
  let code = '';
  for (let i = 0; i < 10; i += 1) code += BASE62[crypto.randomInt(BASE62.length)];
  return code;
}

// -------------------------------------------------------------------- run

async function runPhase(agent, opts, pathFor, seconds) {
  const latencies = [];
  const statusCounts = {};
  let errors = 0;
  const deadline = Date.now() + seconds * 1000;
  const started = process.hrtime.bigint();

  async function worker() {
    while (Date.now() < deadline) {
      const t0 = process.hrtime.bigint();
      try {
        const res = await request(agent, 'GET', `${opts.base}${pathFor()}`);
        latencies.push(Number(process.hrtime.bigint() - t0) / 1e6);
        statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
      } catch {
        errors += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: opts.connections }, worker));
  const elapsed = Number(process.hrtime.bigint() - started) / 1e9;
  return summarize(latencies, statusCounts, elapsed, errors);
}

function printReport(opts, code, r) {
  const f = (n) => n.toFixed(2);
  const lines = [
    '',
    `mode            ${opts.mode}${code ? `  (code ${code})` : ''}`,
    `target          ${opts.base}`,
    `connections     ${opts.connections}`,
    `duration        ${f(r.seconds)} s (after ${opts.warmup} s warm-up)`,
    '',
    `requests        ${r.requests}`,
    `req/s           ${f(r.requestsPerSecond)}`,
    `errors          ${r.errors} (connection errors / timeouts)`,
    `status codes    ${Object.entries(r.statusCounts).map(([k, v]) => `${k}: ${v}`).join('  ') || 'none'}`,
    '',
    'latency (ms)',
    `  min ${f(r.latencyMs.min)}   avg ${f(r.latencyMs.avg)}   p50 ${f(r.latencyMs.p50)}`,
    `  p90 ${f(r.latencyMs.p90)}   p95 ${f(r.latencyMs.p95)}   p99 ${f(r.latencyMs.p99)}   max ${f(r.latencyMs.max)}`,
    '',
  ];
  console.log(lines.join('\n'));

  if ((r.statusCounts[429] || 0) > 0) {
    console.log(
      `WARNING: ${r.statusCounts[429]} responses were 429 (rate limited). These numbers measure the rate limiter, not the service.\n` +
        '         Raise the limits first (see the header of this file) and run again.\n'
    );
  }
  if (r.errors > 0) console.log('WARNING: there were connection errors or timeouts; the stack may be overloaded.\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('See the comment at the top of loadtest/bench.js for usage.');
    return 0;
  }

  const health = await request(new http.Agent(), 'GET', `${opts.base}/health`).catch(() => null);
  if (!health || health.status !== 200) {
    console.error(`The stack is not answering at ${opts.base}/health. Start it first: docker compose up --build`);
    return 2;
  }

  let code = null;
  let pathFor;
  if (opts.mode === 'redirect') {
    code = opts.code || (await createTestUrl(opts.base));
    pathFor = () => `/${code}`;
  } else if (opts.mode === 'miss') {
    pathFor = () => `/${randomMissingCode()}`;
  } else {
    pathFor = () => '/health';
  }

  const agent = new http.Agent({ keepAlive: true, maxSockets: opts.connections });
  console.log(`Warming up for ${opts.warmup} s, then measuring for ${opts.duration} s with ${opts.connections} connections...`);
  if (opts.warmup > 0) await runPhase(agent, { ...opts }, pathFor, opts.warmup);
  await sleep(200);
  const result = await runPhase(agent, opts, pathFor, opts.duration);
  agent.destroy();

  printReport(opts, code, result);
  return (result.statusCounts[429] || 0) > 0 || result.errors > 0 ? 1 : 0;
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`bench: ${err.message}`);
      process.exit(2);
    }
  );
}

module.exports = { parseArgs, percentile, summarize, randomMissingCode };
