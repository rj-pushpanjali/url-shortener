const test = require('node:test');
const assert = require('node:assert/strict');
process.env.LOG_LEVEL = 'silent';
const errorHandler = require('../src/middleware/errorHandler.middleware');
const AppError = require('../src/utils/AppError');

function run(err) {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  errorHandler(err, { id: 'req-1' }, res, () => {});
  return res;
}

test('AppError: its own status and message, plus the request id', () => {
  const res = run(new AppError(409, 'Email is already registered'));
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { success: false, message: 'Email is already registered', requestId: 'req-1' });
});

test('malformed JSON body is a 400, not a 500', () => {
  const res = run(Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed' }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Request body is not valid JSON');
});

test('oversized body is a 413', () => {
  const res = run(Object.assign(new Error('too large'), { type: 'entity.too.large' }));
  assert.equal(res.statusCode, 413);
});

test('unexpected errors are a generic 500 that leaks nothing', () => {
  const res = run(Object.assign(new Error('relation "users" does not exist'), { code: '42P01' }));
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, 'Internal server error');
  assert.ok(!JSON.stringify(res.body).includes('users'));
});
