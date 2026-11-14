const test = require('node:test');
const assert = require('node:assert/strict');
const parseTrustProxy = require('../src/utils/parseTrustProxy');

test('off by default', () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(null), false);
  assert.equal(parseTrustProxy(''), false);
  assert.equal(parseTrustProxy('  '), false);
  assert.equal(parseTrustProxy('false'), false);
});

test('a number means that many proxy hops', () => {
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy(' 2 '), 2);
});

test('"true" is rejected: it would trust any X-Forwarded-For', () => {
  assert.throws(() => parseTrustProxy('true'), /TRUST_PROXY=true/);
  assert.throws(() => parseTrustProxy('TRUE'), /TRUST_PROXY=true/);
});

test('addresses and keywords pass through to Express', () => {
  assert.equal(parseTrustProxy('loopback'), 'loopback');
  assert.equal(parseTrustProxy('172.18.0.0/16'), '172.18.0.0/16');
});
