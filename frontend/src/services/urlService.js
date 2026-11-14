// src/services/urlService.js
//
// One function per /api/urls endpoint. The JWT is attached by request().

import { request } from './api';

export function createShortUrl(longUrl) {
  return request('/api/urls', { method: 'POST', body: { longUrl } });
}

export function fetchMyUrls() {
  return request('/api/urls');
}

export function deleteUrl(id) {
  return request(`/api/urls/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
