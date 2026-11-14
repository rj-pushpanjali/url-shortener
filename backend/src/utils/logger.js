// src/utils/logger.js
//
// Tiny structured logger: one JSON object per line on stdout (debug/info)
// or stderr (warn/error). JSON lines are what log tools (Loki, CloudWatch,
// Datadog, `docker compose logs | jq`) can search and filter.
//
//   logger.info('[server] listening', { port: 5000 });
//   logger.error('[error]', err, { requestId });
//
// Arguments after the message are interpreted by type:
//   Error   -> entry.err = { name, message, code, stack }
//   object  -> its fields are merged into the entry (time/level/msg protected)
//   other   -> appended to the message text ('' / null / undefined ignored)
//
// LOG_LEVEL = debug | info (default) | warn | error | silent. No dependencies.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }; // 'silent' is for tests
const RESERVED = new Set(['time', 'level', 'msg']);

function threshold() {
  const configured = String(process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[configured] ?? LEVELS.info;
}

function serializeError(err) {
  return { name: err.name, message: err.message, code: err.code, stack: err.stack };
}

function buildEntry(level, message, args) {
  let msg = String(message);
  const entry = { time: new Date().toISOString(), level, msg };
  const instance = process.env.INSTANCE_NAME || process.env.SERVICE_NAME;
  if (instance) entry.instance = instance;

  for (const arg of args) {
    if (arg === undefined || arg === null || arg === '') continue;
    if (arg instanceof Error) {
      entry.err = serializeError(arg);
    } else if (typeof arg === 'object') {
      for (const [key, value] of Object.entries(arg)) {
        if (RESERVED.has(key)) continue;
        entry[key] = value instanceof Error ? serializeError(value) : value;
      }
    } else {
      msg += ` ${arg}`;
    }
  }
  entry.msg = msg;
  return entry;
}

function write(level, message, args) {
  if (LEVELS[level] < threshold()) return;
  let line;
  try {
    line = JSON.stringify(buildEntry(level, message, args));
  } catch {
    // e.g. a circular structure in a logged object: never let logging throw.
    line = JSON.stringify({ time: new Date().toISOString(), level, msg: String(message), note: 'unserializable log fields' });
  }
  (LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout).write(`${line}\n`);
}

module.exports = {
  debug: (message, ...args) => write('debug', message, args),
  info: (message, ...args) => write('info', message, args),
  warn: (message, ...args) => write('warn', message, args),
  error: (message, ...args) => write('error', message, args),
  // exported for tests
  buildEntry,
};
