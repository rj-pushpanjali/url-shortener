// src/components/PublicOnlyRoute.jsx
//
// Wraps /login and /register. If you're already logged in there is no
// reason to see them, so go straight to the dashboard.

import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function PublicOnlyRoute({ children }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Navigate to="/" replace /> : children;
}
