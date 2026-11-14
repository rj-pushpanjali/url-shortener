# URL Shortener

A backend/system-design focused URL shortener (Node.js + Express, PostgreSQL,
Redis, BullMQ, React). This README only describes what has actually been
implemented.

**Contents:** [Running with Docker](#running-with-docker-nginx-and-three-backend-instances) ·
[Scaling tests](#scaling-tests) · [Rate limiting](#rate-limiting) ·
[Request validation](#request-validation-zod) · [Unit tests and CI](#unit-tests-and-ci) ·
[Observability](#observability) · [Load testing](#load-testing) ·
[Deploying](#deploying) (details in [DEPLOY.md](DEPLOY.md))

## Running with Docker: Nginx and three backend instances

One command starts the whole stack: an **Nginx load balancer** in front of
**three identical backend instances** (`backend1`, `backend2`, `backend3`)
that share **one Redis** and **one PostgreSQL**. Needs Docker with Compose v2.

```bash
cp .env.example .env     # then set POSTGRES_PASSWORD and JWT_SECRET (the file says how)
docker compose up --build
```

Open <http://localhost:5173>. Short links look like
`http://localhost:5000/abc123`, and the API is at `http://localhost:5000`.

```
                          +--> backend1 --+
browser --> nginx :5000 --+--> backend2 --+--> redis    (cache, rate-limit counters, job queue)
                          +--> backend3 --+--> postgres (users, URLs, click data)
worker (one container) ------------------------^
```

| Service | What it is | Published port |
|---|---|---|
| `nginx` | the load balancer: the **only** way into the API and short links | 5000 |
| `frontend` | the built React app as static files, served by a small nginx image; forwards `/auth` and `/api` to `nginx` | 5173 |
| `backend1`, `backend2`, `backend3` | identical Express instances (same image) | none |
| `worker` | same image; one BullMQ consumer for clicks from **all** instances | none |
| `migrate` | same image; applies SQL migrations once, then exits | none |
| `postgres` | the one shared PostgreSQL 16 (data in the `pgdata` volume) | none |
| `redis` | the one shared Redis 7: redirect cache, rate-limit counters, job queue | none |
| `prometheus` | optional (`--profile monitoring`): scrapes `/metrics` from the three backends | 9090 |

### Nginx in one minute

- **Problem it solves:** one backend is one point of failure and a ceiling
  on throughput. Several instances need something in front that spreads
  requests across them.
- **How it works:** `nginx/nginx.conf` lists the three backends in an
  `upstream` block and proxies every request to the next one in turn
  (round robin: 1, 2, 3, 1, 2, 3...). If an instance stops answering, Nginx
  skips it for a while and retries the request on another, so losing one
  instance isn't visible to users.
- **Why it works for this app:** the app is stateless (next section), so it
  doesn't matter which instance gets a request.
- **Where it fits:** between the outside world and the backends. The backends
  publish no ports, so Nginx is the only way in. That is also why they can
  safely trust the client IP Nginx reports (`TRUST_PROXY=1`): a client can't
  reach a backend directly with a forged `X-Forwarded-For`.
- **What it does *not* do:** it doesn't keep sessions or caches. It is a
  switchboard. It also doesn't change what a short link looks like:
  `BASE_URL` is Nginx's address.

### Why any instance can serve any request

The application keeps nothing about a user or request inside the process:

| State | Where it lives | Why that makes instances interchangeable |
|---|---|---|
| Who you are | a signed JWT sent with each request | every instance holds the same `JWT_SECRET`, so any can verify it. No session to share |
| Users, URLs, clicks | the one PostgreSQL | a single source of truth |
| Redirect cache | the one Redis | an entry cached by one instance is a hit for the others |
| Rate-limit counters | the one Redis | limits are enforced across all instances combined, not per instance |
| Click analytics queue | the one Redis | the one worker handles clicks from every instance |
| Short-code IDs | a PostgreSQL sequence | atomic, so two instances never produce the same code |

If each instance had its own Redis, a client would get three times the rate
limit and three separate caches (a delete on one instance would leave stale
entries on the others). That is why Redis and PostgreSQL are single shared
services.

### Trying it: load balancing and shared state

Every response carries `X-Served-By`, naming the instance that produced it.
Everything below goes through Nginx on port 5000.

```bash
# 1. Round robin: nine requests, three instances, taking turns
for i in $(seq 1 9); do curl -si http://localhost:5000/health | grep -i x-served-by; done

# 2. Nginx's own log shows the backend it picked for each request
docker compose logs --tail 12 nginx          # look for upstream=<ip>:5000

# 3. Stateless login: register and log in, then call the API repeatedly with the same token
curl -s -X POST localhost:5000/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Demo","email":"demo@example.com","password":"password123"}'
curl -s -X POST localhost:5000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"password123"}'      # copy data.token
TOKEN=<paste the token>
for i in 1 2 3 4 5 6; do curl -si localhost:5000/api/urls -H "Authorization: Bearer $TOKEN" \
  | grep -iE '^(HTTP|x-served-by)' | tr '\r\n' '  '; echo; done      # 200 from all three instances

# 4. Shared cache: create a URL, redirect once, then watch the cache entry age across instances
curl -s -X POST localhost:5000/api/urls -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"longUrl":"https://example.com/shared-cache"}'   # note shortCode
CODE=<paste the shortCode>
curl -si localhost:5000/$CODE | grep -iE '^(HTTP|location|x-served-by)'     # miss: PostgreSQL, then cached
docker compose exec redis redis-cli TTL url:$CODE                           # about 3600
sleep 10
for i in 1 2 3; do curl -si localhost:5000/$CODE | grep -iE '^x-served-by'; done   # three different instances
docker compose exec redis redis-cli TTL url:$CODE                           # about 3590: never reset to 3600,
                                                                            # so every instance used the one cached entry

# 5. Shared rate limit: put RATE_LIMIT_LOGIN_MAX=3 in .env, run `docker compose up -d`, then
for i in 1 2 3 4 5 6; do
  curl -si -X POST localhost:5000/auth/login -H "Content-Type: application/json" \
    -d '{"email":"nobody@example.com","password":"wrong-password"}' \
    | grep -iE '^(HTTP|x-served-by)' | tr '\r\n' '  '; echo
done        # 401 401 401 then 429 429 429, while X-Served-By keeps changing

# 6. Shared analytics: click six times (spread across instances); the one worker counts them all
for i in 1 2 3 4 5 6; do curl -s -o /dev/null localhost:5000/$CODE; done
curl -s localhost:5000/api/urls/<id>/analytics -H "Authorization: Bearer $TOKEN"     # totalClicks includes them all

# 7. Losing an instance: stop one, nothing breaks
docker compose stop backend2
for i in $(seq 1 9); do curl -s -o /dev/null -w "%{http_code} " localhost:5000/health; done; echo   # all 200
for i in $(seq 1 6); do curl -si localhost:5000/health | grep -i x-served-by; done   # only backend1 and backend3
docker compose start backend2     # rejoins after Nginx's 10s fail_timeout
```

In step 7 the first request or two may take up to about 2 seconds: Nginx
waits that long to connect to the stopped instance before trying the next
one, then skips it for 10 seconds.

### More commands

```bash
docker compose ps                                  # status and health of every container
docker compose exec nginx nginx -t                 # check the Nginx config syntax
docker compose logs -f nginx backend1 backend2 backend3 worker
docker compose exec redis redis-cli --scan --pattern 'rl:*'        # rate-limit counters
docker compose exec redis redis-cli LLEN bull:click-events:wait    # clicks waiting for the worker
docker compose exec postgres psql -U urlshortener -d url_shortener -c "SELECT * FROM url_stats;"
docker compose down            # stop and remove containers (data is kept)
docker compose down -v         # ALSO delete the database and Redis volumes
```

### Notes

- **Startup order** is enforced with healthchecks: Postgres and Redis become
  healthy, then `migrate` runs and must succeed, then the instances and the
  worker start, then `nginx` (it needs the backend names to exist), then the
  `frontend`.
- **Nginx resolves the backend names once, when it starts.** If you
  re-create a backend container (for example `docker compose up -d` after
  changing its configuration) it can get a new IP address, so run
  `docker compose restart nginx` afterwards.
- **Retries are safe:** Nginx retries a request on another instance if one
  fails, but never replays a POST that an instance already received, so a
  create-URL request is never executed twice by a retry.
- **Client IP in local Docker:** Docker's networking often makes every
  request from your own machine look like it comes from one gateway address,
  so the per-IP rate limits treat all your local requests as a single
  client. That is fine for demos; behind a real network each client keeps
  its own address.
- **Same image:** `backend1-3`, `worker` and `migrate` are the one image
  built from `backend/`; only the command (and `INSTANCE_NAME`) differ.
- **Redis settings:** AOF persistence so queued click jobs survive a restart,
  `noeviction` because BullMQ requires it, and a 256 MB ceiling.
- **Connections:** each Node process keeps up to 10 PostgreSQL connections.
  3 instances + 1 worker is up to 40, under PostgreSQL's default limit of
  100. Many more instances would call for a pooler such as PgBouncer.
- PostgreSQL, Redis and the backends are not published to your machine on
  purpose.
- If you also run the backend directly (`npm start`) or Vite locally, stop
  them first: Docker needs ports 5000 and 5173.
- Run `npm install` once in `backend/` and `frontend/` and commit the
  generated `package-lock.json` files. The Dockerfiles use `npm ci` when a
  lockfile exists and fall back to `npm install` when it doesn't.
- The frontend image is multi-stage: Node builds the app, then only the static
  files are copied into a small nginx image (SPA fallback, hashed assets cached
  for a year, `index.html` never cached, security headers and a strict
  Content-Security-Policy). Its `/api` and `/auth` requests go through the
  load balancer. `npm run dev` in `frontend/` still uses the Vite dev server.
- Inside Docker, Node and Postgres both run in UTC, so the timestamp
  time-zone mismatch that can happen with a local Node and local Postgres
  does not arise.

## Scaling tests

`scaling-tests/run.js` checks, against the **running** Docker stack, that the
claims in this README are true: several identical instances really do behave
as one system. It needs Node 18+ and the Docker CLI, and installs nothing.

```bash
docker compose up --build            # in one terminal (wait until it is healthy)
node scaling-tests/run.js            # in another; add --skip-failover to leave backend2 alone
```

Every check prints `PASS` or `FAIL` with the evidence behind it, and the exit
code is non-zero if anything failed. All traffic goes through Nginx; Docker is
used only to *look at* shared state (Redis TTLs, counters, a PostgreSQL row
count) and, in test 7, to stop and start `backend2`.

| # | Test | A pass proves | A failure would mean |
|---|---|---|---|
| 1 | 30 sequential + 60 parallel requests to `/health` | Nginx spreads load across all three instances, evenly | traffic is stuck on one instance (sticky routing, a dead backend) |
| 2 | one login token used on 12 requests; a tampered token; no token | any instance accepts a token issued by another, and all reject forged ones: JWT is stateless | instances don't share `JWT_SECRET`, or keep sessions in memory |
| 3 | 9 sequential + 12 simultaneous creates; list; redirects; `psql` row count | one PostgreSQL behind all instances; ids strictly increase and never collide; every short code is exactly Base62(id) | per-instance databases, or short codes not coming from the sequence |
| 4 | redirect, then watch the Redis TTL age across instances; delete; redirect again | all instances share **one** cache entry (TTL keeps ageing instead of being reset), and a delete on one instance evicts it for all | per-instance caches (stale redirects after a delete) |
| 5 | wrong logins until blocked | the rate limit is counted **across** instances: exactly `limit` x 401 then 429, and the `remaining` header counts down by one per request although different instances answer | per-instance counters (a client would get ~3x the limit) |
| 6 | 12 clicks via all instances, then poll analytics | clicks from every instance go through the shared queue to the one worker, exactly once each | lost or duplicated clicks, or a worker that isn't consuming |
| 7 | stop `backend2`, send requests, restart it | losing an instance is invisible to users (no failed requests, same token still works, creates aren't duplicated) and it rejoins afterwards | no failover; or Nginx holding a stale IP (the test restarts Nginx and says so) |

How the tests discriminate (so a pass means something):

- **Rate limit:** with a shared counter you see exactly `limit` rejections then
  a 429. With per-instance counters the first 429 would only come after about
  three times as many requests.
- **Cache:** after the first redirect fills the cache, the test waits 4 seconds
  and sends 12 more through all three instances. If any instance had its own
  cache it would fill it and reset the TTL to the full value; instead the TTL
  just keeps counting down.

What the script changes in your dev stack: it deletes the Redis rate-limit
counters (`rl:*`) before it starts, between sections and when it finishes (so
the login lockout it provokes doesn't lock you out afterwards), registers a
test user `scaling-...@example.com`, and leaves its test URLs behind. To
remove them:

```bash
docker compose exec postgres psql -U urlshortener -d url_shortener \
  -c "DELETE FROM users WHERE email LIKE 'scaling-%@example.com';"   # cascades to their URLs and stats
```

### What these tests do not show

- **They are not a benchmark.** Three containers on one laptop share one CPU
  and one disk, so there is no 3x speed-up to claim, and the tests measure no
  throughput or latency. Performance numbers would need a real load tool
  (k6, autocannon), which this project deliberately doesn't add.
- They don't take down Redis or PostgreSQL. Those behaviours (cache skipped,
  rate limiting off, clicks dropped) are built in and described above, but not
  part of this suite.
- One machine, Docker networking, 12-way concurrency: a demonstration of the
  design, not a production-scale proof.

### What you can truthfully say

Only claim what you have watched pass on your own machine.

| Claim | Backed by |
|---|---|
| three stateless Node.js instances behind an Nginx round-robin load balancer | test 1 |
| structured JSON logging, request-id tracing, Prometheus metrics, graceful shutdown | `npm test`, and `curl` against `/metrics` on a backend |
| unit tests and a GitHub Actions pipeline that builds and smoke-tests the whole stack | the CI run on your own repository (after you push it) |
| JWT authentication that works across instances with no shared session store | test 2 |
| shared PostgreSQL; collision-free Base62 short codes from a PostgreSQL sequence across instances | test 3 |
| Redis cache-aside shared across instances, with eviction on delete | test 4 |
| Redis-backed distributed rate limiting enforced across instances | test 5 |
| asynchronous click analytics with BullMQ and a separate worker | test 6 |
| keeps serving when one instance is lost | test 7 |

Not backed by anything here, so don't claim it: throughput or latency
numbers until you have measured them (see [Load testing](#load-testing)).

## Request validation (Zod)

Every request body and `:id` path parameter is validated by a
[Zod](https://zod.dev) schema before it reaches a controller:

- `backend/src/validators/auth.schema.js`: register and login
- `backend/src/validators/url.schema.js`: create URL (http/https only, max 2048 chars) and the `:id` parameter
- `backend/src/middleware/validate.middleware.js`: `validate(schema, 'body' | 'params')` runs the schema, replaces `req.body`/`req.params` with the cleaned value (trimmed, lower-cased email, unknown fields dropped) and answers `400` with the first message in the usual JSON envelope

`GET /:code` answers `404` immediately for anything that cannot be a short
code (not 1-11 Base62 characters), without a Redis or PostgreSQL lookup.

## Unit tests and CI

```bash
cd backend && npm install && npm test        # Node's built-in test runner, no test framework to install
node --test "loadtest/test/*.test.js"         # self-test of the load-test script (from the project root)
```

The backend tests cover Base62 encoding, the Zod schemas and the validation
middleware, the URL service (with in-memory stand-ins for PostgreSQL and
Redis: cache hit/miss/fill, delete-then-evict, a deleted user's token),
the error handler, the request-id middleware, the logger and the metrics
registry.

`.github/workflows/ci.yml` runs on every push and pull request: the backend
tests, a frontend build, then it **builds every Docker image, starts the whole
stack and runs `scaling-tests/run.js --skip-failover`** against it. It also
checks that `/metrics` works on the backends and is blocked through nginx.

## Observability

- **Structured logs.** Every log line is one JSON object (`time`, `level`,
  `msg`, plus fields). Filter with `docker compose logs backend1 | jq 'select(.status >= 500)'`.
  `LOG_LEVEL=debug|info|warn|error` controls the volume.
- **Request ids.** Nginx stamps every request with `X-Request-Id`; the backend
  reuses it in its log lines, in the response header and in the `requestId`
  field of error responses; nginx's own access log prints it as `request_id=`.
  One string finds one request in every log.
- **Metrics.** Each backend serves Prometheus metrics on `GET /metrics`:
  `http_requests_total` and `http_request_duration_seconds` (labelled by
  method, route *pattern* and status), `redirect_cache_lookups_total{result}`,
  `click_events_enqueued_total`, `click_events_dropped_total`,
  `rate_limited_total{limiter}`, plus process memory and uptime. Nginx answers
  `404` for `/metrics`, so it is only reachable inside the Docker network.
  Start Prometheus with `docker compose --profile monitoring up -d` and open
  <http://localhost:9090>; example queries are in `monitoring/prometheus.yml`.
- **Health.** `GET /health` reports PostgreSQL and Redis; the container
  healthchecks use it.
- **Graceful shutdown.** On `SIGTERM` a backend stops accepting connections,
  finishes in-flight requests, then closes PostgreSQL, Redis and the queue.

## Load testing

`loadtest/bench.js` is a dependency-free load generator: it reports requests
per second and latency percentiles (p50/p90/p95/p99) for the cache-hit
redirect path, the uncached PostgreSQL path, and `/health`. Raise the rate
limits first, or you will measure the rate limiter. Full instructions, and a
table to write your own measured results in, are in
[docs/PERFORMANCE.md](docs/PERFORMANCE.md). No numbers are claimed in this
repository: run it on your machine and report what you measure.

```bash
node loadtest/bench.js --mode redirect --duration 30 --connections 50
```

## Deploying

`docker-compose.prod.yml` adds Caddy (automatic HTTPS) in front of the same
stack and closes every host port except 80 and 443. It uses two host names:
one for the app and one for the short links. Step by step, with backups and a
security checklist, in [DEPLOY.md](DEPLOY.md).

## Rate limiting

Implemented with `express-rate-limit` and `rate-limit-redis`. The counters
live in the **shared Redis server**, not in Node's memory, so when several
backend instances run behind Nginx they all see the same counts. (With
in-memory counters, three instances would each allow the full limit, so a
client would really get 3x.)

**How it works.** For every request a key is built (client IP, or user id
once logged in). Redis atomically increments a counter named
`rl:<limiter>:<key>` that expires when the window ends (a *fixed window*).
Past the limit the API answers `429` with the usual JSON envelope:

```json
{ "success": false, "message": "Too many failed login attempts. Please try again in a few minutes." }
```

plus `Retry-After` and `RateLimit` / `RateLimit-Policy` headers. Each limiter
has its own key prefix, so budgets never mix.

### Limits and why

| Where | Key | Default limit | Reasoning |
|---|---|---|---|
| `POST /auth/login` | IP | 10 **failed** attempts / 15 min | Stops password guessing. 10 tolerates honest typos. Successful logins don't count, so normal use never hits it. Each attempt also costs a deliberately slow bcrypt comparison, so this protects server CPU too. Keyed by IP, not by account, so an attacker cannot lock a victim out of their own account. |
| `POST /auth/register` | IP | 5 / hour | A real person registers once. This blocks mass fake-account creation, and 5 leaves room for a few people behind one shared IP. |
| `POST /api/urls` | user | 30 / minute | A human creates a handful of links. A script firing hundreds is spam and burns database writes and sequence values. |
| all `/api/urls` routes | user | 120 / minute | Roughly 2 requests per second sustained, far above any dashboard use. A broad ceiling against scripts and runaway clients. Keyed by user so people sharing an IP don't eat each other's budget. |
| `GET /:code` (redirect) | IP | 300 / minute | The hottest public path, so the most generous: about 5 per second per IP covers offices and campuses sharing one address. It still slows scraping, code enumeration and click inflation. |
| `GET /health` | none | unlimited | Monitoring and load-balancer health checks must always get through. |

All limits can be lowered or raised with environment variables (see
`backend/.env.example`), e.g. `RATE_LIMIT_LOGIN_MAX=3` for a quick demo.

### What happens when Redis is down: fail open

If Redis is unreachable, requests are **allowed through without limiting**
and the outage is logged (at most once every 30 seconds). The reasoning:
Redis is already optional for redirects (cache) and analytics (queue), and
a Redis outage should not also lock everyone out of logging in.

The cost is real and deliberate: while Redis is down, brute-force
protection on login is off. A system guarding something more sensitive
could choose to fail closed on the login route instead.

### Known limitations

- **Per-IP limits are blunt.** Many users behind one NAT share a budget
  (hence generous redirect limits), and a botnet with many IPs is not
  stopped by per-IP counting.
- **Fixed windows allow a burst at the boundary:** up to 2x the limit can
  pass in a short span straddling two windows. Sliding windows avoid this
  at the cost of more complexity.
- **Short codes are sequential** (Base62 of a database sequence), so they
  can be enumerated. Rate limiting slows that down; it does not prevent it.
- **Behind Nginx, `TRUST_PROXY=1`** (Docker Compose sets it). Without it
  every user appears to have Nginx's IP and all share one limit. It is off
  by default when you run the backend directly, because trusting
  `X-Forwarded-For` on an exposed app lets clients fake their IP. In
  Compose it is safe because the backends publish no ports, so only Nginx
  can reach them. `TRUST_PROXY=true` is rejected on purpose.

### Trying it

```bash
# 12 wrong logins from one IP: ten 401s, then 429s
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:5000/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"nobody@example.com","password":"wrong-password"}'
done

redis-cli --scan --pattern 'rl:*'                      # the counters
redis-cli --scan --pattern 'rl:*' | xargs redis-cli del  # reset them (handy in development)
```
