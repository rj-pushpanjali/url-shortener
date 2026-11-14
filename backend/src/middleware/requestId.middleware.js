// src/middleware/requestId.middleware.js
//
// Gives every request an id, exposes it as req.id and in the X-Request-Id
// response header, and uses it in log lines and error responses. Nginx sets
// X-Request-Id on every request it forwards ($request_id), so the same id
// shows up in the nginx log, the backend log and the response a user sees:
// one string to search for when something goes wrong.
//
// An incoming id is only kept if it looks sane (letters, digits, - and _,
// at most 64 characters); anything else is replaced, so a client can't
// inject junk into the logs.

const crypto = require('crypto');

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

module.exports = requestId;
