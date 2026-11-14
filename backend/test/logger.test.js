const test = require('node:test');
const assert = require('node:assert/strict');
const logger = require('../src/utils/logger');

function capture(fn, level = 'debug') {
  const out = [];
  const err = [];
  const oldOut = process.stdout.write;
  const oldErr = process.stderr.write;
  const oldLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  process.stderr.write = (s) => { err.push(String(s)); return true; };
  try {
    fn();
  } finally {
    process.stdout.write = oldOut;
    process.stderr.write = oldErr;
    if (oldLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = oldLevel;
  }
  return { out, err };
}

test('info goes to stdout as one JSON line with time, level and msg', () => {
  const { out, err } = capture(() => logger.info('hello', { requestId: 'r1', status: 200 }));
  assert.equal(err.length, 0);
  assert.equal(out.length, 1);
  assert.ok(out[0].endsWith('\n'));
  const entry = JSON.parse(out[0]);
  assert.equal(entry.level, 'info');
  assert.equal(entry.msg, 'hello');
  assert.equal(entry.requestId, 'r1');
  assert.equal(entry.status, 200);
  assert.ok(!Number.isNaN(Date.parse(entry.time)));
});

test('error goes to stderr and serialises an Error argument', () => {
  const { out, err } = capture(() => logger.error('[x] failed', new Error('boom')));
  assert.equal(out.length, 0);
  const entry = JSON.parse(err[0]);
  assert.equal(entry.level, 'error');
  assert.equal(entry.err.message, 'boom');
  assert.match(entry.err.stack, /boom/);
});

test('primitive extra arguments are appended to the message; empty ones ignored', () => {
  const { out } = capture(() => logger.info('[redis] failed:', 'ECONNREFUSED', '', null, undefined));
  assert.equal(JSON.parse(out[0]).msg, '[redis] failed: ECONNREFUSED');
});

test('object fields cannot overwrite time, level or msg', () => {
  const { out } = capture(() => logger.info('real', { level: 'fake', msg: 'fake', time: 'fake', ok: 1 }));
  const entry = JSON.parse(out[0]);
  assert.equal(entry.level, 'info');
  assert.equal(entry.msg, 'real');
  assert.notEqual(entry.time, 'fake');
  assert.equal(entry.ok, 1);
});

test('LOG_LEVEL filters lower levels', () => {
  const { out, err } = capture(() => {
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
  }, 'warn');
  assert.equal(out.length, 0);
  assert.equal(err.length, 1);
});

test('a circular structure does not throw', () => {
  const circular = {};
  circular.self = circular;
  const { out } = capture(() => logger.info('loop', circular));
  assert.equal(JSON.parse(out[0]).level, 'info');
});
