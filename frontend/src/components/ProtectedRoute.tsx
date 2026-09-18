import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import UnlockOverlay from "./UnlockOverlay";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { token, kek, needsUnlock, sessionExpired } = useAuth();

  // JWT is dead: ask for the password again without mounting data hooks,
  // otherwise every tab change retries 401s.
  if (sessionExpired) return <UnlockOverlay />;

  // Not authenticated at all → full login flow.
  if (!token) return <Navigate to="/login" replace />;

  // Token + salt survived in sessionStorage but the KEK is gone (post-refresh).
  // Do not mount Layout/Outlet until the KEK exists — those pages fire
  // entries/skills/habits queries even when the overlay is up.
  if (needsUnlock || !kek) return <UnlockOverlay />;

  return <>{children}</>;
}
