// src/routes/metrics.routes.js
//
// GET /metrics: Prometheus scrape endpoint for THIS instance.
//
// Not rate limited and not authenticated, so it must never be reachable from
// the internet: nginx answers 404 for /metrics (see nginx/nginx.conf) and the
// backends publish no ports. Prometheus scrapes the backends directly on the
// internal Docker network.

const express = require('express');
const { render, CONTENT_TYPE } = require('../utils/metrics');

const router = express.Router();

router.get('/metrics', (req, res) => {
  res.setHeader('Content-Type', CONTENT_TYPE);
  res.status(200).send(render());
});

module.exports = router;
