# Deploying to a server

This puts the whole stack on **one Linux server** with a real domain and
automatic HTTPS. Same compose file as local development, plus
`docker-compose.prod.yml`, which adds Caddy and closes every port except 80
and 443.

> Not tested on a live server by the author of this file: follow it once
> end to end and fix anything specific to your provider. The steps below are
> standard Docker Compose and Caddy.

## What you need

- A small VPS (1 vCPU / 2 GB RAM is enough for a demo). Free or cheap options
  exist (for example the Oracle Cloud "Always Free" ARM VMs, or any ~$5/month
  VPS). Ubuntu 22.04 or 24.04 is assumed.
- **Two host names** pointing at the server's public IP (DNS `A` records):
  - `app.yourdomain.com`: the website
  - `go.yourdomain.com`: the short links (`https://go.yourdomain.com/abc123`)

  Two names are needed because short links sit at the root of their domain and
  would collide with the app's own pages (`/login`, `/register`) on one name.
  A cheap domain, or free subdomains from a DNS provider, both work.
- Ports **80 and 443** open in the provider's firewall.

## Steps

```bash
# 1. Install Docker (includes Compose v2; this setup needs Compose 2.24 or newer)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # log out and back in afterwards
docker compose version

# 2. Get the code onto the server (git clone, or scp the folder)
git clone <your-repo-url> url-shortener && cd url-shortener

# 3. Configure
cp .env.production.example .env
nano .env        # set both domains, BASE_URL, POSTGRES_PASSWORD and JWT_SECRET
                 # (the file shows how to generate strong values)

# 4. Start
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# 5. Check
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
curl -s https://go.yourdomain.com/health
```

Open `https://app.yourdomain.com`, register, shorten a link, open the short
link. The first HTTPS request can take a few seconds while Caddy obtains the
certificates (it needs the DNS records and ports 80/443 to work).

To avoid typing both `-f` files every time:

```bash
echo 'COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml' >> .env
docker compose up -d --build        # now uses both files
```

## Day-to-day

```bash
docker compose logs -f backend1 worker caddy      # logs are JSON lines: pipe to jq
docker compose logs backend1 | jq 'select(.status >= 500)'
git pull && docker compose up -d --build           # deploy a new version
docker compose restart nginx                       # after backends are re-created (new IPs)
docker compose --profile monitoring up -d prometheus   # optional metrics (port 9090 is NOT firewalled off by default: do not expose it; use an SSH tunnel)
```

Metrics: Prometheus listens on port 9090 of the server. Keep that port closed
in the firewall and look at it through an SSH tunnel:
`ssh -L 9090:localhost:9090 you@server`, then open http://localhost:9090.

## Backups

All data is in two volumes. The important one is PostgreSQL.

```bash
# backup
docker compose exec -T postgres pg_dump -U urlshortener url_shortener | gzip > backup-$(date +%F).sql.gz

# restore into an empty database
gunzip -c backup-2026-01-01.sql.gz | docker compose exec -T postgres psql -U urlshortener url_shortener
```

Run the backup from cron (`crontab -e`) and copy the files off the server.
Redis only holds a cache, rate-limit counters and the click queue; losing it
loses at most a few queued clicks.

## Security checklist

- `.env` is never committed (it is in `.gitignore`); `chmod 600 .env`.
- Only Caddy publishes ports (80/443). Postgres, Redis, the backends, nginx and
  the frontend are reachable only inside the Docker network. Verify from your
  own computer: `nmap <server-ip>` should show only 22, 80 and 443.
- `TRUST_PROXY=2` in `.env`: the client IP passes through Caddy and then
  nginx. With 1 every visitor would share a rate-limit budget; never use `true`.
- Keep the server patched (`sudo apt update && sudo apt upgrade`), SSH by key
  only, and consider `ufw allow 22,80,443/tcp && ufw enable`.

## If something goes wrong

| Symptom | Likely cause |
|---|---|
| Browser says the certificate is invalid / Caddy logs ACME errors | DNS records don't point at this server yet, or ports 80/443 are blocked |
| Short links open `http://localhost...` | `BASE_URL` in `.env` is wrong; fix it and `docker compose up -d` |
| Everyone is rate limited at once | `TRUST_PROXY` is 1 instead of 2 |
| `service "nginx" ... !reset` error | Docker Compose is older than 2.24: upgrade it |
