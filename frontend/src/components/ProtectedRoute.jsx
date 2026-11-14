// src/components/ProtectedRoute.jsx
//
// Wraps pages that require login. No token -> redirect to /login.
// This is a UX convenience only. Real protection is the backend's JWT
// check on every /api/urls call; hiding a page in the browser secures
// nothing by itself.

import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}
