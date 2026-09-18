import { useQuery } from "@tanstack/react-query";
import { getSessionToken, useAuth } from "../context/AuthContext";
import { api, AuthError } from "../lib/api";

/**
 * Shared catalog queries. Keys omit the JWT so a silent refresh does not
 * refetch; `enabled` already gates on a live token.
 */
export function useSkills() {
  const { token } = useAuth();
  return useQuery({
    queryKey: ["skills"],
    enabled: Boolean(token),
    queryFn: () => {
      const t = getSessionToken();
      if (!t) throw new AuthError("session expired");
      return api.listSkills(t);
    },
  });
}

export function useHabits() {
  const { token } = useAuth();
  return useQuery({
    queryKey: ["habits"],
    enabled: Boolean(token),
    queryFn: () => {
      const t = getSessionToken();
      if (!t) throw new AuthError("session expired");
      return api.listHabits(t);
    },
  });
}
