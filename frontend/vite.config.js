// vite.config.js
//
// PROXY: the browser talks only to the Vite server (port 5173), which
// forwards /auth and /api to the backend (port 5000; in Docker, the
// `backend` container). To the browser
// everything is same-origin, so no CORS setup is needed on the backend.
// (A production build would get the same effect from Nginx in Stage 11.)
//
// This proxy is for `npm run dev` only. In Docker, the production image is
// nginx serving the built files (see frontend/Dockerfile and nginx.conf).
//
// NOTE: short URLs (http://localhost:5000/abc123) are NOT proxied. They are
// plain links the user clicks or pastes, which go straight to the backend.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BACKEND = process.env.VITE_BACKEND_URL || 'http://localhost:5000';

// Same rules for `vite dev` and `vite preview` (a local check of the build).
const proxy = {
  '/auth': BACKEND,
  '/api': BACKEND,
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 5173, proxy },
});
