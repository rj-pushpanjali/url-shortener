// src/services/api.js
//
// One small wrapper around fetch(). Every backend call goes through
// request(), so the Authorization header, JSON handling and error shape
// live in exactly one place. (Plain fetch: no axios needed for this.)

import { getToken } from './tokenStorage';

// Empty by default: relative URLs, forwarded by the Vite dev proxy.
const BASE_URL = import.meta.env?.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status; // 0 means the server could not be reached
  }
}

// AuthContext registers a callback here so that an expired/invalid token
// (a 401 on an authenticated call) logs the user out in one central place
// instead of every page handling it separately.
let onUnauthorized = null;
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

/**
 * @param {string} path           e.g. '/api/urls'
 * @param {object} options
 * @param {string} [options.method]
 * @param {object} [options.body]  JSON-serialised
 * @param {boolean} [options.auth] send the JWT (default true). Login and
 *                                 register pass false: a 401 there means
 *                                 "wrong password", not "session expired".
 */
export async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Please try again.', 0);
  }

  // The backend always answers with JSON, but don't crash if a proxy or
  // crash page returns something else.
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && auth && onUnauthorized) {
      onUnauthorized();
    }
    throw new ApiError(payload?.message || 'Something went wrong.', response.status);
  }

  return payload;
}
