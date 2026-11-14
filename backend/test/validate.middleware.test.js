const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');
const validate = require('../src/middleware/validate.middleware');

const schema = z.object({ n: z.coerce.number().int('n must be an integer') });

test('valid input: replaces req[source] with the parsed value and calls next()', () => {
  const req = { body: { n: '7', extra: 'dropped' } };
  let nextArg = 'unset';
  validate(schema)(req, {}, (arg) => { nextArg = arg; });
  assert.equal(nextArg, undefined);
  assert.deepEqual(req.body, { n: 7 });
});

test('invalid input: forwards an AppError(400) with the first message', () => {
  const req = { body: { n: 1.5 } };
  let err;
  validate(schema)(req, {}, (e) => { err = e; });
  assert.equal(err.isAppError, true);
  assert.equal(err.statusCode, 400);
  assert.equal(err.message, 'n must be an integer');
});

test('can validate params instead of the body', () => {
  const req = { params: { n: '3' } };
  let nextArg = 'unset';
  validate(schema, 'params')(req, {}, (arg) => { nextArg = arg; });
  assert.equal(nextArg, undefined);
  assert.deepEqual(req.params, { n: 3 });
});
