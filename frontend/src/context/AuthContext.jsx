// src/context/AuthContext.jsx
//
// Holds "who is logged in" for the whole app and exposes login, register
// and logout through the useAuth() hook. The JWT itself lives in
// localStorage (see services/tokenStorage.js); this context mirrors it in
// React state so components re-render when the user logs in or out.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setUnauthorizedHandler } from '../services/api';
import { loginUser, registerUser } from '../services/authService';
import { clearSession, getToken, getUser, saveSession } from '../services/tokenStorage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Read once on first render, so a page refresh keeps you logged in.
  const [token, setToken] = useState(() => getToken());
  const [user, setUser] = useState(() => getUser());

  const logout = useCallback(() => {
    clearSession();
    setToken(null);
    setUser(null);
  }, []);

  // If any authenticated request comes back 401 (expired or invalid
  // token), log out. ProtectedRoute then sends the user to /login.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const login = useCallback(async (email, password) => {
    const response = await loginUser({ email, password });
    const { token: newToken, user: newUser } = response.data;
    saveSession(newToken, newUser);
    setToken(newToken);
    setUser(newUser);
  }, []);

  // Registering does NOT log you in: the backend returns the user but no
  // token (login is the only endpoint that issues one).
  const register = useCallback(async (name, email, password) => {
    await registerUser({ name, email, password });
  }, []);

  const value = useMemo(
    () => ({ token, user, isAuthenticated: Boolean(token), login, register, logout }),
    [token, user, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
