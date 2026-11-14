// Self-test for bench.js: unit checks plus a run against a tiny local HTTP
// server (so no stack is needed). Run with:  node --test loadtest/test/
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { parseArgs, percentile, summarize, randomMissingCode } = require('../bench');

test('parseArgs: defaults and overrides', () => {
  const d = parseArgs([]);
  assert.equal(d.mode, 'redirect');
  assert.equal(d.duration, 10);
  const o = parseArgs(['--mode', 'miss', '--duration', '3', '--connections', '7', '--code', 'abc']);
  assert.deepEqual([o.mode, o.duration, o.connections, o.code], ['miss', 3, 7, 'abc']);
});

test('parseArgs: rejects bad input', () => {
  assert.throws(() => parseArgs(['--mode', 'nope']), /--mode must be/);
  assert.throws(() => parseArgs(['--duration', '0']), /above 0/);
  assert.throws(() => parseArgs(['--connections', 'abc']), /non-negative/);
  assert.throws(() => parseArgs(['--wat']), /Unknown option/);
  assert.throws(() => parseArgs(['--mode']), /needs a value/);
});

test('percentile (nearest rank)', () => {
  const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(data, 50), 5);
  assert.equal(percentile(data, 95), 10);
  assert.equal(percentile(data, 0), 1);
  assert.equal(percentile([], 50), 0);
});

test('summarize', () => {
  const s = summarize([1, 2, 3, 4], { 302: 4 }, 2, 0);
  assert.equal(s.requests, 4);
  assert.equal(s.requestsPerSecond, 2);
  assert.equal(s.latencyMs.min, 1);
  assert.equal(s.latencyMs.max, 4);
  assert.equal(s.latencyMs.avg, 2.5);
});

test('randomMissingCode looks like a short code', () => {
  assert.match(randomMissingCode(), /^[0-9a-zA-Z]{10}$/);
});

function runBench(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'bench.js'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
}

test('redirect mode against a local server: counts 302s, exits 0', async () => {
  await withServer(
    (req, res) => {
      if (req.url === '/health') { res.end('ok'); return; }
      res.writeHead(302, { Location: 'https://example.com' });
      res.end();
    },
    async (base) => {
      const { code, out } = await runBench(['--base', base, '--code', 'abc', '--duration', '1', '--warmup', '0', '--connections', '4']);
      assert.equal(code, 0, out);
      assert.match(out, /status codes\s+302: \d+/);
      assert.match(out, /req\/s\s+[\d.]+/);
      assert.doesNotMatch(out, /WARNING/);
    }
  );
});

test('exits non-zero and warns when the server rate limits', async () => {
  await withServer(
    (req, res) => {
      if (req.url === '/health') { res.end('ok'); return; }
      res.writeHead(429);
      res.end();
    },
    async (base) => {
      const { code, out } = await runBench(['--base', base, '--code', 'abc', '--duration', '1', '--warmup', '0', '--connections', '2']);
      assert.equal(code, 1, out);
      assert.match(out, /rate limited/);
    }
  );
});

test('reports a clear error when nothing is listening', async () => {
  const { code, out } = await runBench(['--base', 'http://127.0.0.1:1', '--duration', '1']);
  assert.equal(code, 2);
  assert.match(out, /not answering/);
});
