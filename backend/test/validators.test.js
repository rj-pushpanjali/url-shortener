const test = require('node:test');
const assert = require('node:assert/strict');
const { registerSchema, loginSchema } = require('../src/validators/auth.schema');
const { createUrlSchema, idParamSchema, SHORT_CODE_REGEX } = require('../src/validators/url.schema');

const firstMessage = (schema, input) => {
  const r = schema.safeParse(input);
  assert.equal(r.success, false, 'expected validation to fail');
  return r.error.issues[0].message;
};

test('register: trims the name, lower-cases and trims the email', () => {
  const r = registerSchema.parse({ name: '  Ada  ', email: '  ADA@Example.COM ', password: 'password123' });
  assert.deepEqual(r, { name: 'Ada', email: 'ada@example.com', password: 'password123' });
});

test('register: drops unknown fields', () => {
  const r = registerSchema.parse({ name: 'A', email: 'a@b.co', password: 'password123', isAdmin: true });
  assert.equal('isAdmin' in r, false);
});

test('register: rejects bad input with client-safe messages', () => {
  const ok = { name: 'Ada', email: 'ada@example.com', password: 'password123' };
  assert.equal(firstMessage(registerSchema, { ...ok, name: '   ' }), 'name is required');
  assert.equal(firstMessage(registerSchema, { ...ok, name: 'x'.repeat(101) }), 'name must be at most 100 characters');
  assert.equal(firstMessage(registerSchema, { ...ok, email: 'nope' }), 'email must be a valid email address');
  assert.equal(firstMessage(registerSchema, { ...ok, email: undefined }), 'email is required');
  assert.equal(firstMessage(registerSchema, { ...ok, password: 'short' }), 'password must be at least 8 characters');
  assert.equal(firstMessage(registerSchema, { ...ok, password: 'a'.repeat(73) }), 'password must be at most 72 bytes');
  assert.equal(firstMessage(registerSchema, { ...ok, password: undefined }), 'password is required');
});

test('register: the 72-byte limit counts bytes, not characters', () => {
  const ok = { name: 'Ada', email: 'ada@example.com' };
  // 40 two-byte characters = 80 bytes but only 40 characters
  assert.equal(firstMessage(registerSchema, { ...ok, password: 'é'.repeat(40) }), 'password must be at most 72 bytes');
  assert.ok(registerSchema.safeParse({ ...ok, password: 'a'.repeat(72) }).success);
});

test('register: a body that is not an object is rejected', () => {
  assert.equal(firstMessage(registerSchema, [1, 2]), 'Request body must be a JSON object');
  assert.equal(firstMessage(registerSchema, undefined), 'Request body must be a JSON object');
});

test('login: does not enforce the password policy', () => {
  assert.ok(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success);
  assert.equal(firstMessage(loginSchema, { email: 'a@b.co', password: '' }), 'password is required');
  assert.equal(firstMessage(loginSchema, { email: 'bad', password: 'x' }), 'email must be a valid email address');
});

test('createUrl: accepts http and https, trims', () => {
  assert.equal(createUrlSchema.parse({ longUrl: '  https://example.com/a?b=1  ' }).longUrl, 'https://example.com/a?b=1');
  assert.ok(createUrlSchema.safeParse({ longUrl: 'http://example.com' }).success);
});

test('createUrl: rejects everything else', () => {
  assert.equal(firstMessage(createUrlSchema, {}), 'longUrl is required');
  assert.equal(firstMessage(createUrlSchema, { longUrl: 42 }), 'longUrl is required and must be a string');
  assert.equal(firstMessage(createUrlSchema, { longUrl: '   ' }), 'longUrl is required and must be a non-empty string');
  assert.equal(firstMessage(createUrlSchema, { longUrl: 'not a url' }), 'longUrl must be a valid URL');
  assert.equal(firstMessage(createUrlSchema, { longUrl: 'ftp://example.com/file' }), 'longUrl must use http:// or https://');
  assert.equal(firstMessage(createUrlSchema, { longUrl: 'javascript:alert(1)' }), 'longUrl must use http:// or https://');
  assert.equal(firstMessage(createUrlSchema, { longUrl: `https://example.com/${'a'.repeat(2100)}` }), 'longUrl must be at most 2048 characters');
});

test('id param: digits only, 1 to 19 of them', () => {
  assert.ok(idParamSchema.safeParse({ id: '1' }).success);
  assert.ok(idParamSchema.safeParse({ id: '9223372036854775807' }).success);
  for (const bad of ['', 'abc', '1; DROP TABLE users', '-1', '1.5', '1'.repeat(20)]) {
    assert.equal(firstMessage(idParamSchema, { id: bad }), 'Invalid URL id');
  }
});

test('SHORT_CODE_REGEX accepts real codes and rejects junk', () => {
  for (const ok of ['1', 'Zz9', '21', 'aZ0aZ0aZ0aZ']) assert.match(ok, SHORT_CODE_REGEX);
  for (const bad of ['', 'favicon.ico', 'wp-login.php', 'a b', 'aZ0aZ0aZ0aZ0', 'ünï']) assert.doesNotMatch(bad, SHORT_CODE_REGEX);
});
