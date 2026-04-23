import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import UnlockOverlay from "./UnlockOverlay";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { token, kek, needsUnlock } = useAuth();

  // Not authenticated at all → full login flow.
  if (!token) return <Navigate to="/login" replace />;

  // Token + salt survived in sessionStorage but the KEK is gone (post-refresh).
  // Render the layout underneath so the nav is visible, and overlay the
  // password modal on top. We don't expose children here to keep encrypt/
  // decrypt paths unreachable until the KEK is re-derived.
  if (needsUnlock || !kek) {
    return (
      <>
        <div aria-hidden className="pointer-events-none select-none opacity-40">
          {children}
        </div>
        <UnlockOverlay />
      </>
    );
  }

  return <>{children}</>;
}
