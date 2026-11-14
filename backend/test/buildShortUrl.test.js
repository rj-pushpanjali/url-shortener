const test = require('node:test');
const assert = require('node:assert/strict');
const { buildShortUrl, getBaseUrl } = require('../src/utils/buildShortUrl');

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('falls back to http://localhost:<PORT>', () => {
  withEnv({ BASE_URL: undefined, PORT: '5001' }, () => assert.equal(getBaseUrl(), 'http://localhost:5001'));
  withEnv({ BASE_URL: '', PORT: undefined }, () => assert.equal(getBaseUrl(), 'http://localhost:5000'));
});

test('uses BASE_URL and strips trailing slashes', () => {
  withEnv({ BASE_URL: 'https://go.example.com/' }, () => {
    assert.equal(getBaseUrl(), 'https://go.example.com');
    assert.equal(buildShortUrl('abc'), 'https://go.example.com/abc');
  });
});

test('rejects a malformed or non-http BASE_URL', () => {
  withEnv({ BASE_URL: 'not a url' }, () => assert.throws(() => getBaseUrl(), /not a valid URL/));
  withEnv({ BASE_URL: 'ftp://example.com' }, () => assert.throws(() => getBaseUrl(), /http:\/\/ or https:\/\//));
});
