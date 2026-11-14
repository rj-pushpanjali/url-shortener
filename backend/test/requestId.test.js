const test = require('node:test');
const assert = require('node:assert/strict');
const requestId = require('../src/middleware/requestId.middleware');

function run(headers) {
  const req = { headers };
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; } };
  requestId(req, res, () => {});
  return { req, res };
}

test('keeps a sane incoming id and echoes it', () => {
  const { req, res } = run({ 'x-request-id': 'abc123-DEF_456' });
  assert.equal(req.id, 'abc123-DEF_456');
  assert.equal(res.headers['X-Request-Id'], 'abc123-DEF_456');
});

test('generates a UUID when there is none', () => {
  const { req } = run({});
  assert.match(req.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('replaces ids that could pollute the logs', () => {
  for (const bad of ['has space', 'new\nline', 'x'.repeat(65), '<script>']) {
    const { req } = run({ 'x-request-id': bad });
    assert.notEqual(req.id, bad);
    assert.match(req.id, /^[0-9a-f-]{36}$/);
  }
});
