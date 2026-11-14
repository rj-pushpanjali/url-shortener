const test = require('node:test');
const assert = require('node:assert/strict');
const { encode, decode } = require('../src/utils/base62');

test('encode known values', () => {
  assert.equal(encode(0), '0');
  assert.equal(encode(61), 'Z');
  assert.equal(encode(62), '10');
  assert.equal(encode(125), '21');
  assert.equal(encode('125'), '21'); // pg returns BIGINT as a string
});

test('decode reverses encode, including the largest BIGINT', () => {
  for (const n of [1n, 61n, 62n, 3844n, 123456789n, 9223372036854775807n]) {
    assert.equal(decode(encode(n)), n);
  }
});

test('largest BIGINT fits the 11-character short-code limit', () => {
  assert.equal(encode('9223372036854775807').length, 11);
});

test('rejects negative numbers and invalid characters', () => {
  assert.throws(() => encode(-1), /non-negative/);
  assert.throws(() => decode('ab-c'), /invalid character/);
});

test('every code from 1 to 5000 is unique and URL-safe', () => {
  const seen = new Set();
  for (let i = 1; i <= 5000; i += 1) {
    const code = encode(i);
    assert.match(code, /^[0-9a-zA-Z]+$/);
    assert.ok(!seen.has(code), `duplicate code ${code}`);
    seen.add(code);
  }
});
