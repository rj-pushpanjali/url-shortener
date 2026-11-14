# frontend/Dockerfile
#
# Two stages:
#   1. build:  Node installs dependencies and runs `vite build` -> /app/dist
#   2. serve:  a small nginx image that only contains the built static files
#
# The final image has no Node, no node_modules and no source code: smaller,
# faster to start, and a much smaller attack surface than `vite preview`.
# nginx.conf serves the files (with SPA fallback and caching) and proxies
# /api and /auth to the load balancer; see that file.

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN npm run build

FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
