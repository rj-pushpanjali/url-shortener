# Performance

How to measure this system, and where to write down what you measured.
**This file contains no results on purpose.** Numbers depend on your
hardware, so run the commands below and fill in the table yourself. Only put
numbers on a resume that you measured.

## 1. Prepare the stack for a benchmark

The default rate limits would answer almost every request with `429`. In
`.env` raise them and quieten the logs:

```
RATE_LIMIT_REDIRECT_MAX=100000000
RATE_LIMIT_REGISTER_MAX=1000
LOG_LEVEL=warn
```

```bash
docker compose up -d --build
docker compose restart nginx
```

(Put the limits back afterwards.)

## 2. Run

```bash
node loadtest/bench.js --mode redirect --duration 30 --connections 50   # hot path: Redis cache hit
node loadtest/bench.js --mode miss     --duration 30 --connections 50   # PostgreSQL lookup, 404
node loadtest/bench.js --mode health   --duration 30 --connections 50   # /health
```

Run each three times and keep the median. Close other heavy programs first.
The load generator, nginx, the backends, Postgres and Redis all share one
machine, so these numbers describe this setup on your hardware, not a
production capacity.

To compare one instance with three, stop two backends
(`docker compose stop backend2 backend3`, wait ~10 s, run, then
`docker compose start backend2 backend3` and `docker compose restart nginx`).
On one machine, three instances may not be faster than one if the CPU is
already saturated: report what you see.

## 3. Watch it while it runs (optional)

```bash
docker compose --profile monitoring up -d prometheus      # http://localhost:9090
```

Useful queries are listed at the top of `monitoring/prometheus.yml`
(requests per second per instance, redirect p95, cache hit ratio, 429s).

## 4. Results (fill in)

Machine: ______ (CPU, cores, RAM, OS)  Date: ______  Commit: ______

| Mode | Connections | req/s (median of 3) | p50 ms | p95 ms | p99 ms | 429s / errors |
|---|---|---|---|---|---|---|
| redirect (cache hit) | 50 | | | | | |
| miss (PostgreSQL) | 50 | | | | | |
| health | 50 | | | | | |

What the comparison tells you: `redirect` vs `miss` is what the Redis cache is
worth (memory lookup vs a PostgreSQL query). A fair resume line is, for
example: "redirects served from the Redis cache at X req/s, p95 Y ms (single
machine, 3 instances), Z times faster than the uncached PostgreSQL path".
Replace X, Y and Z with your own measurements.
