// src/services/authService.js
//
// One function per auth endpoint. No state here; AuthContext owns that.

import { request } from './api';

export function registerUser({ name, email, password }) {
  return request('/auth/register', { method: 'POST', body: { name, email, password }, auth: false });
}

export function loginUser({ email, password }) {
  return request('/auth/login', { method: 'POST', body: { email, password }, auth: false });
}
