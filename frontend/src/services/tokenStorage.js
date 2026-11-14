// src/services/tokenStorage.js
//
// The only place that touches localStorage. The JWT and the basic user
// object are stored so a page refresh keeps you logged in.
//
// TRADE-OFF (good interview point): localStorage is readable by any
// JavaScript on the page, so an XSS bug could steal the token. An httpOnly
// cookie is not readable by scripts, but needs backend changes (cookie
// handling plus CSRF protection). For this project, localStorage with a
// short token lifetime (1h) is the simple, common choice. React escapes
// rendered values by default, which reduces XSS risk.
//
// Every access is wrapped in try/catch because localStorage can throw
// (private browsing modes, storage disabled, corrupted JSON).

const TOKEN_KEY = 'urlshortener.token';
const USER_KEY = 'urlshortener.user';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(token, user) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // Storage unavailable: the session just won't survive a refresh.
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    // nothing to do
  }
}
