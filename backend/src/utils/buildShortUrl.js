// src/utils/buildShortUrl.js
//
// Builds the public short link shown to users, e.g. http://localhost:5001/abc123.
//
// WHY THIS IS CONFIGURABLE: the port the app LISTENS on inside its container
// (always 5000) is not the address users reach it at. With several backend
// containers and then Nginx in front (Stages 10-11), the public address is
// whatever the outside world uses, and the app can't discover that by
// itself. So it's configuration: BASE_URL. If unset, it falls back to
// http://localhost:<PORT>, which is right for plain local development.

function getBaseUrl() {
  const raw = process.env.BASE_URL;

  if (!raw || raw.trim() === '') {
    return `http://localhost:${process.env.PORT || 5000}`;
  }

  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error(`BASE_URL "${raw}" is not a valid URL. Example: http://localhost:5000`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`BASE_URL must start with http:// or https:// (got "${raw}")`);
  }

  // No trailing slash, so `${base}/${code}` never produces a double slash.
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

function buildShortUrl(shortCode) {
  return `${getBaseUrl()}/${shortCode}`;
}

module.exports = { buildShortUrl, getBaseUrl };
