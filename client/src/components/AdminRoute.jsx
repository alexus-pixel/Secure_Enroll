import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * ProtectedRoute (existing) only checks "is someone logged in".
 * The admin section needs a second gate on top of that: is this
 * specific someone an admin. This is a client-side convenience,
 * not the real enforcement — every admin API route is independently
 * guarded by requirePermission() on the server, so a non-admin
 * poking the API directly still gets a 403 regardless of what this
 * component does. This just avoids rendering admin screens (and
 * making doomed API calls) for a role that can never use them.
 */
export default function AdminRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
}
