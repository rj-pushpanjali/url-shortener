#!/usr/bin/env node
'use strict';
//
// scaling-tests/run.js
//
// End-to-end scaling tests for the running Docker Compose stack:
//   Nginx -> backend1 / backend2 / backend3 -> shared Redis + shared PostgreSQL
//
// Usage (stack must be up: `docker compose up --build`):
//   node scaling-tests/run.js                 # all tests
//   node scaling-tests/run.js --skip-failover # skip the test that stops backend2
//
// Needs Node 18+ and the Docker CLI. No npm install: only Node's own modules.
// Everything goes through Nginx (default http://localhost:5000, override with
// BASE_URL). Docker is used only to LOOK at shared state (Redis TTLs, counters,
// PostgreSQL row counts) and, in the failover test, to stop/start backend2.
//
// Each check prints PASS or FAIL with the evidence behind it. The exit code is
// 0 only if every check passed.
//
// WHAT THIS CHANGES in your dev stack: it deletes Redis rate-limit counters
// (rl:*) at the start, between sections and at the end, so the login lockout
// it provokes doesn't lock you out afterwards. It creates a test user
// (scaling-...@example.com) and some short URLs, which it leaves behind.

const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const BASE = new URL(process.env.BASE_URL || 'http://localhost:5000');
const PROJECT_DIR = path.resolve(__dirname, '..');
const INSTANCES = ['backend1', 'backend2', 'backend3'];
const SKIP_FAILOVER = process.argv.includes('--skip-failover');

// ---------------------------------------------------------------- helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const agent = new http.Agent({ keepAlive: true, maxSockets: 50 });

function request(method, urlPath, { headers = {}, body, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const started = Date.now();
    const req = http.request(
      {
        hostname: BASE.hostname,
        port: BASE.port || 80,
        path: urlPath,
        method,
        agent,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch { /* not JSON */ }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            json,
            text,
            ms: Date.now() - started,
            servedBy: res.headers['x-served-by'] || null,
          });
        });
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`no response after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// `docker compose <args>` run from the project root
function docker(args) {
  return new Promise((resolve) => {
    execFile('docker', ['compose', ...args], { cwd: PROJECT_DIR, timeout: 180000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() });
    });
  });
}
const redisCli = (...args) => docker(['exec', '-T', 'redis', 'redis-cli', ...args]);

async function resetRateLimits() {
  const scan = await redisCli('--scan', '--pattern', 'rl:*');
  if (!scan.ok) return false;
  const keys = scan.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (keys.length > 0) await redisCli('DEL', ...keys);
  return true;
}

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
function base62(value) {
  let n = BigInt(value);
  if (n === 0n) return ALPHABET[0];
  let out = '';
  while (n > 0n) { out = ALPHABET[Number(n % 62n)] + out; n /= 62n; }
  return out;
}

const tally = (items) => items.reduce((m, k) => { const key = k ?? 'unknown'; m[key] = (m[key] || 0) + 1; return m; }, {});
const fmt = (t) => Object.keys(t).sort().map((k) => `${k}:${t[k]}`).join('  ');
const distinct = (items) => new Set(items.filter(Boolean)).size;
const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

// ------------------------------------------------------------- reporting

const results = [];
function section(title) { console.log(`\n=== ${title} ===`); }
function check(label, ok, evidence = '') {
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${evidence ? `\n        ${evidence}` : ''}`);
  return ok;
}
function note(message) { console.log(`        note: ${message}`); }

// ------------------------------------------------------------- preflight

class Abort extends Error {}

async function preflight() {
  section('0. Preflight');

  if (Number(process.versions.node.split('.')[0]) < 18) throw new Abort(`Node 18+ is required (this is ${process.version}).`);

  const version = await docker(['version']);
  if (!version.ok) throw new Abort('The Docker CLI with Compose v2 is required (`docker compose version` failed).');

  const missing = [];
  for (const service of ['postgres', 'redis', 'backend1', 'backend2', 'backend3', 'nginx', 'worker']) {
    const r = await docker(['exec', '-T', service, 'true']);
    if (!r.ok) missing.push(service);
  }
  if (missing.length > 0) {
    throw new Abort(`These services are not running: ${missing.join(', ')}. Start the stack first: docker compose up --build`);
  }
  check('all services are running (postgres, redis, backend1-3, nginx, worker)', true);

  let health;
  try { health = await request('GET', '/health'); } catch (err) {
    throw new Abort(`Cannot reach ${BASE.origin}/health through Nginx: ${err.message}`);
  }
  if (health.status !== 200) throw new Abort(`GET /health returned ${health.status}: ${health.text.slice(0, 200)}`);
  if (!health.servedBy) throw new Abort('Responses carry no X-Served-By header, so instances cannot be told apart. docker-compose.yml sets INSTANCE_NAME per backend; is this the Stage 10+ stack?');
  check('reachable through Nginx; /health is 200 and responses carry X-Served-By', true, `${BASE.origin} -> ${health.servedBy}`);
  check('PostgreSQL and Redis both report connected', health.json && health.json.db === 'connected' && health.json.redis === 'connected', JSON.stringify(health.json));
  if (!(health.json && health.json.redis === 'connected')) throw new Abort('Redis is not connected; the shared-state tests cannot run.');
}

async function setupUser() {
  const email = `scaling-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@example.com`;
  const password = 'scaling-test-password';
  const reg = await request('POST', '/auth/register', { body: { name: 'Scaling Test', email, password } });
  if (reg.status !== 201) throw new Abort(`Could not register the test user (status ${reg.status}): ${reg.text.slice(0, 200)}`);
  const login = await request('POST', '/auth/login', { body: { email, password } });
  if (login.status !== 200 || !login.json?.data?.token) throw new Abort(`Could not log in the test user (status ${login.status}): ${login.text.slice(0, 200)}`);
  console.log(`      test user: ${email} (registered via ${reg.servedBy}, logged in via ${login.servedBy})`);
  return { email, password, token: login.json.data.token };
}

// ---------------------------------------------------------------- tests

async function testLoadBalancing() {
  section('1. Multiple instances and load balancing (Nginx round robin)');

  const sequential = [];
  for (let i = 0; i < 30; i++) sequential.push(await request('GET', '/health'));
  const t = tally(sequential.map((r) => r.servedBy));
  check('30 sequential requests all succeed', sequential.every((r) => r.status === 200), fmt(tally(sequential.map((r) => r.status))));
  check('all three instances served traffic', INSTANCES.every((n) => t[n] > 0), fmt(t));
  const counts = INSTANCES.map((n) => t[n] || 0);
  check('round robin spreads them evenly (busiest minus quietest <= 4)', Math.max(...counts) - Math.min(...counts) <= 4, fmt(t));

  const parallel = [];
  for (let batch = 0; batch < 3; batch++) {
    parallel.push(...(await Promise.all(Array.from({ length: 20 }, () => request('GET', '/health')))));
  }
  const p = tally(parallel.map((r) => r.servedBy));
  check('a parallel burst of 60 requests all succeed', parallel.every((r) => r.status === 200), fmt(tally(parallel.map((r) => r.status))));
  check('...and every instance handled at least 10 of them', INSTANCES.every((n) => (p[n] || 0) >= 10), fmt(p));
}

async function testJwt(user) {
  section('2. Stateless JWT authentication');

  const valid = [];
  for (let i = 0; i < 12; i++) valid.push(await request('GET', '/api/urls', { headers: authHeader(user.token) }));
  check('one token (issued by a single login) is accepted on 12 requests', valid.every((r) => r.status === 200), fmt(tally(valid.map((r) => r.status))));
  const t = tally(valid.map((r) => r.servedBy));
  check('...and those requests were served by all three instances', INSTANCES.every((n) => t[n] > 0), fmt(t));

  const [header, payload, signature] = user.token.split('.');
  const flipped = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A');
  const forged = [];
  for (let i = 0; i < 6; i++) forged.push(await request('GET', '/api/urls', { headers: authHeader(`${header}.${payload}.${flipped}`) }));
  check('a tampered token is rejected (401) by every instance', forged.every((r) => r.status === 401) && distinct(forged.map((r) => r.servedBy)) >= 2, `${fmt(tally(forged.map((r) => r.status)))} | ${fmt(tally(forged.map((r) => r.servedBy)))}`);

  const anonymous = [];
  for (let i = 0; i < 3; i++) anonymous.push(await request('GET', '/api/urls'));
  check('requests with no token are rejected (401) on every instance', anonymous.every((r) => r.status === 401), fmt(tally(anonymous.map((r) => r.servedBy))));
}

async function testSharedDatabase(user) {
  section('3. Shared PostgreSQL (and the sequence behind the short codes)');
  await resetRateLimits();

  const stamp = Date.now();
  const sequential = [];
  for (let i = 0; i < 9; i++) {
    const r = await request('POST', '/api/urls', { headers: authHeader(user.token), body: { longUrl: `https://example.com/scaling/${stamp}/seq-${i}` } });
    sequential.push(r);
  }
  check('9 sequential creates all succeed (201)', sequential.every((r) => r.status === 201), fmt(tally(sequential.map((r) => r.status))));
  const created = sequential.filter((r) => r.status === 201).map((r) => ({ ...r.json.data, creator: r.servedBy }));
  check('creates were handled by at least 2 different instances', distinct(created.map((c) => c.creator)) >= 2, fmt(tally(created.map((c) => c.creator))));
  check('ids strictly increase across instances (one shared sequence)', created.every((c, i) => i === 0 || BigInt(c.id) > BigInt(created[i - 1].id)), created.map((c) => c.id).join(', '));
  check('every shortCode equals Base62(id), whichever instance made it', created.every((c) => base62(c.id) === c.shortCode), created.map((c) => `${c.id}->${c.shortCode}`).join('  '));

  const concurrent = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      request('POST', '/api/urls', { headers: authHeader(user.token), body: { longUrl: `https://example.com/scaling/${stamp}/par-${i}` } })
    )
  );
  check('12 simultaneous creates all succeed', concurrent.every((r) => r.status === 201), fmt(tally(concurrent.map((r) => r.status))));
  const parallelCreated = concurrent.filter((r) => r.status === 201).map((r) => ({ ...r.json.data, creator: r.servedBy }));
  const all = [...created, ...parallelCreated];
  check('...with 12 distinct ids and 12 distinct short codes (no collisions across instances)',
    new Set(parallelCreated.map((c) => c.id)).size === parallelCreated.length && new Set(parallelCreated.map((c) => c.shortCode)).size === parallelCreated.length,
    `${new Set(all.map((c) => c.shortCode)).size} distinct codes out of ${all.length} created in total`);
  check('...and each is Base62(id)', parallelCreated.every((c) => base62(c.id) === c.shortCode));

  const list = await request('GET', '/api/urls', { headers: authHeader(user.token) });
  const listedIds = new Set((list.json?.data || []).map((u) => String(u.id)));
  check('the list endpoint (on whichever instance answers) shows all 21 URLs created through all instances', all.every((c) => listedIds.has(String(c.id))), `listed ${listedIds.size}, created ${all.length}`);

  let cross = 0; const redirects = [];
  for (const c of created) {
    const r = await request('GET', `/${c.shortCode}`);
    redirects.push(r);
    if (r.servedBy && r.servedBy !== c.creator) cross++;
  }
  check('9 redirects all return 302 to the right long URL', redirects.every((r, i) => r.status === 302 && r.headers.location === `https://example.com/scaling/${stamp}/seq-${i}`), fmt(tally(redirects.map((r) => r.status))));
  check('...and some were served by a DIFFERENT instance than the one that created the URL', cross >= 1, `${cross} of 9 read through another instance`);

  const identity = await docker(['exec', '-T', 'postgres', 'printenv', 'POSTGRES_USER']);
  const dbName = await docker(['exec', '-T', 'postgres', 'printenv', 'POSTGRES_DB']);
  if (identity.ok && dbName.ok) {
    const sql = `SELECT count(*) FROM url_mapping m JOIN users u ON u.id = m.user_id WHERE u.email = '${user.email}'`;
    const count = await docker(['exec', '-T', 'postgres', 'psql', '-U', identity.stdout, '-d', dbName.stdout, '-tAc', sql]);
    if (count.ok) check('the one PostgreSQL holds all 21 rows (counted directly with psql)', parseInt(count.stdout, 10) === all.length, `psql says ${count.stdout}`);
    else note(`skipped the direct PostgreSQL count: ${count.stderr.slice(0, 120)}`);
  } else {
    note('skipped the direct PostgreSQL count (could not read the Postgres container settings)');
  }
}

async function testSharedCache(user) {
  section('4. Shared Redis cache');
  await resetRateLimits();

  const created = await request('POST', '/api/urls', { headers: authHeader(user.token), body: { longUrl: `https://example.com/scaling/cache/${Date.now()}` } });
  if (!check('created a URL to cache', created.status === 201)) return;
  const { id, shortCode } = created.json.data;
  const key = `url:${shortCode}`;

  const ttlSetting = await docker(['exec', '-T', 'backend1', 'printenv', 'URL_CACHE_TTL_SECONDS']);
  const configuredTtl = parseInt(ttlSetting.stdout, 10) || 3600;

  const before = await redisCli('EXISTS', key);
  check('before any redirect the URL is not in the cache', before.ok && before.stdout === '0', `EXISTS ${key} -> ${before.stdout}`);

  const first = await request('GET', `/${shortCode}`);
  const ttl1 = parseInt((await redisCli('TTL', key)).stdout, 10);
  check('first redirect (a cache miss) answered 302 and filled the SHARED cache', first.status === 302 && ttl1 > 0 && ttl1 <= configuredTtl && ttl1 >= configuredTtl - 10,
    `served by ${first.servedBy}; Redis TTL of ${key} = ${ttl1}s (configured ${configuredTtl}s)`);

  await sleep(4000);
  const hits = [];
  for (let i = 0; i < 12; i++) hits.push(await request('GET', `/${shortCode}`));
  const ttl2 = parseInt((await redisCli('TTL', key)).stdout, 10);
  const t = tally(hits.map((r) => r.servedBy));
  check('12 more redirects all answered 302, served by all three instances', hits.every((r) => r.status === 302) && INSTANCES.every((n) => t[n] > 0), fmt(t));
  check('the cache entry kept AGING (TTL not reset to the full value), so no instance re-filled it: all of them used the one shared entry',
    ttl2 > 0 && ttl2 < ttl1 && ttl1 - ttl2 <= 15, `TTL went ${ttl1}s -> ${ttl2}s`);

  const del = await request('DELETE', `/api/urls/${id}`, { headers: authHeader(user.token) });
  check('deleting the URL (on one instance) succeeds', del.status === 200, `served by ${del.servedBy}`);
  const exists = await redisCli('EXISTS', key);
  check('...and evicts the shared cache entry', exists.ok && exists.stdout === '0', `EXISTS ${key} -> ${exists.stdout}`);
  const after = [];
  for (let i = 0; i < 6; i++) after.push(await request('GET', `/${shortCode}`));
  check('...so every instance now answers 404 (no instance serves a stale copy)', after.every((r) => r.status === 404) && distinct(after.map((r) => r.servedBy)) === 3, `${fmt(tally(after.map((r) => r.status)))} | ${fmt(tally(after.map((r) => r.servedBy)))}`);
}

async function testSharedRateLimit() {
  section('5. Shared rate limiting (login limiter, counted across all instances)');
  const reset = await resetRateLimits();
  if (!reset) note('could not clear old rate-limit counters; results may be skewed');

  const email = `nobody-${Date.now()}@example.com`;
  const attempts = [];
  let limit = null;
  for (let i = 0; i < 40; i++) {
    const r = await request('POST', '/auth/login', { body: { email, password: 'wrong-password' } });
    attempts.push(r);
    if (limit === null) {
      const policy = String(r.headers['ratelimit-policy'] || '').match(/^\s*(\d+)/);
      const header = String(r.headers.ratelimit || '').match(/limit=(\d+)/i);
      limit = policy ? Number(policy[1]) : header ? Number(header[1]) : null;
    }
    if (r.status === 429) break;
  }
  const effectiveLimit = limit ?? 10;
  if (limit === null) note('no RateLimit headers were visible; assuming the default limit of 10');

  const first429 = attempts.findIndex((r) => r.status === 429);
  const rejected = attempts.filter((r) => r.status === 401);
  check(`wrong logins are rejected (401) until the limit of ${effectiveLimit}, then blocked (429)`,
    first429 === effectiveLimit && rejected.length === effectiveLimit,
    first429 === -1
      ? `no 429 after ${attempts.length} wrong logins. If each instance counted separately the first 429 would only appear after ~${effectiveLimit * 3}`
      : `${rejected.length} x 401, then 429 on attempt ${first429 + 1}`);
  check('those attempts were spread over all three instances (so the single count really is combined)', INSTANCES.every((n) => rejected.some((r) => r.servedBy === n)), fmt(tally(rejected.map((r) => r.servedBy))));

  const remaining = rejected.map((r) => { const m = String(r.headers.ratelimit || '').match(/remaining=(\d+)/i); return m ? Number(m[1]) : null; });
  if (remaining.every((v) => v !== null) && remaining.length > 0) {
    check('the "remaining" counter counts down by exactly 1 per request, even though different instances answer',
      remaining.every((v, i) => v === effectiveLimit - (i + 1)), `remaining: ${remaining.join(', ')}  served by: ${rejected.map((r) => r.servedBy.replace('backend', 'b')).join(' ')}`);
  } else {
    note('skipped the "remaining" countdown check (RateLimit header not present or not parseable)');
  }

  const blocked = attempts[first429];
  if (blocked) {
    check('the 429 uses the standard JSON error shape and carries Retry-After',
      blocked.json && blocked.json.success === false && typeof blocked.json.message === 'string' && Number(blocked.headers['retry-after']) > 0,
      `${blocked.text.slice(0, 110)} | Retry-After: ${blocked.headers['retry-after']}`);
  }
  const health = await request('GET', '/health');
  check('/health is not rate limited while logins are blocked', health.status === 200);

  await resetRateLimits();
  note('cleared the rate-limit counters so you are not left locked out');
}

async function testAnalytics(user) {
  section('6. Shared queue and analytics (BullMQ + one worker + shared PostgreSQL)');
  await resetRateLimits();

  const created = await request('POST', '/api/urls', { headers: authHeader(user.token), body: { longUrl: `https://example.com/scaling/analytics/${Date.now()}` } });
  if (!check('created a URL to click', created.status === 201)) return;
  const { id, shortCode } = created.json.data;

  const clicks = [];
  for (let i = 0; i < 12; i++) clicks.push(await request('GET', `/${shortCode}`));
  const t = tally(clicks.map((r) => r.servedBy));
  check('12 clicks all answered 302, spread over all three instances', clicks.every((r) => r.status === 302) && INSTANCES.every((n) => t[n] > 0), fmt(t));

  let analytics = null;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const r = await request('GET', `/api/urls/${id}/analytics`, { headers: authHeader(user.token) });
    analytics = r.json && r.json.data;
    if (analytics && analytics.totalClicks >= 12) break;
    await sleep(500);
  }
  check('the single worker recorded exactly 12 clicks, one per click from every instance', !!analytics && analytics.totalClicks === 12, `totalClicks = ${analytics ? analytics.totalClicks : 'no analytics response'}`);

  await sleep(1500);
  const settled = await request('GET', `/api/urls/${id}/analytics`, { headers: authHeader(user.token) });
  const data = settled.json && settled.json.data;
  check('the count stays at 12 (nothing counted twice, nothing arrives late)', !!data && data.totalClicks === 12, `totalClicks = ${data ? data.totalClicks : 'n/a'}`);
  check('the raw click log (click_events) holds 12 events and a last-clicked time', !!data && Array.isArray(data.recentClicks) && data.recentClicks.length === 12 && !!data.lastClickedAt, data ? `${data.recentClicks.length} recent clicks, last at ${data.lastClickedAt}` : '');
}

async function testFailover(user) {
  section('7. Losing an instance (stop backend2, then bring it back)');
  await resetRateLimits();
  try {
    const stop = await docker(['stop', 'backend2']);
    if (!check('stopped backend2', stop.ok, stop.stderr.slice(0, 160))) return;
    await sleep(500);

    const during = [];
    for (let i = 0; i < 20; i++) {
      try { during.push(await request('GET', '/health', { timeoutMs: 20000 })); }
      catch (err) { during.push({ status: 0, servedBy: null, ms: 0, error: err.message }); }
    }
    const failures = during.filter((r) => r.status !== 200);
    const t = tally(during.map((r) => r.servedBy));
    const slowest = Math.max(...during.map((r) => r.ms));
    check('20 requests with backend2 down: none failed', failures.length === 0, failures.length ? failures.map((r) => r.error || r.status).join('; ') : `slowest ${slowest}ms (the first requests wait for Nginx's 2s connect timeout)`);
    check('...and none were served by backend2; backend1 and backend3 carried them all', !t.backend2 && t.backend1 > 0 && t.backend3 > 0, fmt(t));

    const reads = [];
    for (let i = 0; i < 4; i++) reads.push(await request('GET', '/api/urls', { headers: authHeader(user.token), timeoutMs: 20000 }));
    check('the same login token keeps working on the surviving instances (stateless JWT)', reads.every((r) => r.status === 200), fmt(tally(reads.map((r) => r.status))));
    const writes = [];
    for (let i = 0; i < 3; i++) writes.push(await request('POST', '/api/urls', { headers: authHeader(user.token), body: { longUrl: `https://example.com/scaling/failover/${Date.now()}-${i}` }, timeoutMs: 20000 }));
    const ids = writes.map((w) => w.json?.data?.id).filter(Boolean);
    check('creating URLs still works, each created exactly once (no duplicates from retries)', writes.every((w) => w.status === 201) && new Set(ids).size === 3, fmt(tally(writes.map((w) => w.status))));
  } finally {
    const start = await docker(['start', 'backend2']);
    if (!start.ok) console.log(`      WARNING: could not restart backend2 (${start.stderr.slice(0, 120)}). Run: docker compose start backend2`);
  }

  const seen = async (seconds) => {
    const until = Date.now() + seconds * 1000;
    while (Date.now() < until) {
      const batch = await Promise.all([1, 2, 3].map(() => request('GET', '/health', { timeoutMs: 20000 }).catch(() => ({ servedBy: null }))));
      if (batch.some((r) => r.servedBy === 'backend2')) return true;
      await sleep(1000);
    }
    return false;
  };
  let back = await seen(45);
  if (back) {
    check('backend2 rejoins the rotation after it restarts', true);
  } else {
    note('backend2 did not rejoin on its own. Nginx looks up backend names only at startup, so a restarted container with a new IP needs: docker compose restart nginx. Doing that now.');
    await docker(['restart', 'nginx']);
    await sleep(3000);
    back = await seen(30);
    check('backend2 rejoins the rotation after an Nginx restart (documented limitation: Nginx caches backend IPs)', back);
  }
}

// ------------------------------------------------------------------ main

let cleaningUp = false;
async function cleanup() {
  if (cleaningUp) return;
  cleaningUp = true;
  await docker(['start', 'backend2']);
  await resetRateLimits();
}
process.on('SIGINT', async () => { console.log('\ninterrupted; cleaning up...'); await cleanup(); process.exit(130); });

(async () => {
  console.log(`Scaling tests against ${BASE.origin}  (project: ${PROJECT_DIR})`);
  try {
    await preflight();
    await resetRateLimits();
    const user = await setupUser();

    await testLoadBalancing();
    await testJwt(user);
    await testSharedDatabase(user);
    await testSharedCache(user);
    await testSharedRateLimit();
    await testAnalytics(user);
    if (SKIP_FAILOVER) { section('7. Losing an instance'); note('skipped (--skip-failover)'); }
    else await testFailover(user);
  } catch (err) {
    console.log(`\nABORTED: ${err.message}`);
    if (!(err instanceof Abort)) console.log(err.stack);
    await cleanup();
    process.exit(2);
  }
  await cleanup();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'-'.repeat(60)}\n${results.length - failed.length} of ${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log('FAILED:');
    failed.forEach((r) => console.log(`  - ${r.label}`));
    process.exit(1);
  }
  console.log('ALL SCALING CHECKS PASSED');
})();
