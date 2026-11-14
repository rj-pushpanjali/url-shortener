// src/middleware/metrics.middleware.js
//
// Records request count and duration for every response.
//
// The "route" label is the route PATTERN ("/api/urls/:id", "/:code"), never
// the raw URL, so label values stay few however many different short codes
// or ids are requested. A request no route handled is labelled "unmatched".

const { httpRequestsTotal, httpRequestDuration } = require('../utils/metrics');

function routeLabel(req) {
  return req.route ? `${req.baseUrl || ''}${req.route.path}` : 'unmatched';
}

function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = routeLabel(req);
    httpRequestsTotal.inc({ method: req.method, route, status: res.statusCode });
    httpRequestDuration.observe({ method: req.method, route }, seconds);
  });

  next();
}

module.exports = metricsMiddleware;
module.exports.routeLabel = routeLabel;
