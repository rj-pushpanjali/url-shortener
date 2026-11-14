// url.service with its repositories replaced by in-memory stubs (no database,
// no Redis). The stubs go into require.cache BEFORE the service is loaded.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relativePath, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relativePath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const db = { nextId: '125', inserted: null, insertError: null, found: undefined, deleted: undefined, deleteArgs: null };
const cache = { value: null, set: [], evicted: [] };

stub('src/repositories/url.repository.js', {
  getNextId: async () => db.nextId,
  insertUrlMapping: async (args) => {
    if (db.insertError) throw db.insertError;
    db.inserted = args;
    return { id: args.id, short_code: args.shortCode, long_url: args.longUrl, created_at: 'now' };
  },
  findByShortCode: async () => db.found,
  findAllByUserId: async () => [],
  deleteByIdAndUserId: async (id, userId) => { db.deleteArgs = [id, userId]; return db.deleted; },
});
stub('src/repositories/urlCache.repository.js', {
  getCachedLongUrl: async () => cache.value,
  setCachedLongUrl: async (code, url) => { cache.set.push([code, url]); },
  deleteCachedLongUrl: async (code) => { cache.evicted.push(code); },
});

const service = require('../src/services/url.service');
const { render } = require('../src/utils/metrics');

test.beforeEach(() => {
  Object.assign(db, { nextId: '125', inserted: null, insertError: null, found: undefined, deleted: undefined, deleteArgs: null });
  Object.assign(cache, { value: null, set: [], evicted: [] });
});

test('createShortUrl: the short code is Base62 of the sequence id', async () => {
  const result = await service.createShortUrl('https://example.com', '7');
  assert.equal(result.shortCode, '21');
  assert.deepEqual(db.inserted, { id: '125', userId: '7', shortCode: '21', longUrl: 'https://example.com' });
});

test('createShortUrl: a deleted user (foreign key violation) becomes a 401', async () => {
  db.insertError = Object.assign(new Error('fk'), { code: '23503' });
  await assert.rejects(service.createShortUrl('https://example.com', '7'), (e) => e.isAppError && e.statusCode === 401);
});

test('createShortUrl: other database errors are not swallowed', async () => {
  db.insertError = Object.assign(new Error('boom'), { code: 'XX000' });
  await assert.rejects(service.createShortUrl('https://example.com', '7'), /boom/);
});

test('getOriginalUrl: cache hit skips PostgreSQL', async () => {
  cache.value = 'https://cached.example';
  db.found = { long_url: 'https://db.example' };
  assert.equal(await service.getOriginalUrl('abc'), 'https://cached.example');
  assert.deepEqual(cache.set, []);
});

test('getOriginalUrl: cache miss reads PostgreSQL and fills the cache', async () => {
  db.found = { long_url: 'https://db.example' };
  assert.equal(await service.getOriginalUrl('abc'), 'https://db.example');
  assert.deepEqual(cache.set, [['abc', 'https://db.example']]);
});

test('getOriginalUrl: unknown code returns null and is NOT cached', async () => {
  assert.equal(await service.getOriginalUrl('nope'), null);
  assert.deepEqual(cache.set, []);
});

test('getOriginalUrl: records hit and miss counters', async () => {
  cache.value = 'https://cached.example';
  await service.getOriginalUrl('abc');
  cache.value = null;
  db.found = { long_url: 'https://db.example' };
  await service.getOriginalUrl('abc');
  const text = render();
  assert.match(text, /redirect_cache_lookups_total\{result="hit"\} [1-9]/);
  assert.match(text, /redirect_cache_lookups_total\{result="miss"\} [1-9]/);
});

test('deleteUserUrl: 404 when nothing matched (missing or someone else\'s)', async () => {
  await assert.rejects(service.deleteUserUrl('5', '7'), (e) => e.isAppError && e.statusCode === 404);
  assert.deepEqual(cache.evicted, []);
});

test('deleteUserUrl: deletes in PostgreSQL scoped to the user, then evicts the cache', async () => {
  db.deleted = { id: '5', short_code: 'abc' };
  await service.deleteUserUrl('5', '7');
  assert.deepEqual(db.deleteArgs, ['5', '7']);
  assert.deepEqual(cache.evicted, ['abc']);
});
