// src/middleware/instanceHeader.middleware.js
//
// Adds an "X-Served-By: <name>" response header, so when several identical
// backend instances run behind a load balancer you can SEE which one
// answered a given request (curl -i, or the browser's network tab).
//
// Off unless INSTANCE_NAME is set (docker-compose.yml sets it per instance
// for the demos). It reveals internal naming to clients, so leave it unset
// in a real deployment.

function instanceHeader(req, res, next) {
  const name = process.env.INSTANCE_NAME;
  if (name) {
    res.setHeader('X-Served-By', name);
  }
  next();
}

module.exports = instanceHeader;
