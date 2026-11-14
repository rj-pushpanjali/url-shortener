# backend/Dockerfile
#
# ONE image, used for THREE jobs (the command is chosen in docker-compose.yml):
#   web server  ->  node src/server.js                  (default CMD below)
#   worker      ->  node src/queues/clickEvent.worker.js
#   migrations  ->  node scripts/migrate.js
# Same code, same image, different command. Stage 10 will run this same
# image as backend1/backend2/backend3.
#
# node:22-bookworm-slim (Debian, glibc) rather than Alpine: bcrypt is a
# native module and its prebuilt binaries are the safest fit on glibc.

FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, in their own layer: rebuilds after a code-only change
# reuse the cached install instead of downloading everything again.
# `npm ci` (exact, reproducible versions) is used when a package-lock.json
# exists. Without one it falls back to `npm install`. Run `npm install`
# once locally and commit the lockfile so builds are reproducible.
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
    && npm cache clean --force

COPY . .

# Never run as root inside the container.
USER node

EXPOSE 5000


# Exec form (a JSON array) so Node receives signals directly; compose also
# sets `init: true` so a real init process handles SIGTERM on `docker stop`.

CMD ["sh", "-c", "npm run migrate && npm start"]