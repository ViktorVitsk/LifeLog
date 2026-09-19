import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { getSessionId } from "../lib/accountScope";
import { TOKEN_A, TOKEN_A_LATE, TOKEN_B } from "./authContextFixture";

const SALT = "ab".repeat(16);
const PASSWORD = "component-test-password";

function Harness() {
  const auth = useAuth();
  const [, redraw] = useState(0);
  const [error, setError] = useState("");

  const run = async (work: () => Promise<void>) => {
    setError("");
    try {
      await work();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      redraw((value) => value + 1);
    }
  };

  return (
    <main>
      <output data-testid="user">{auth.userId ?? "none"}</output>
      <output data-testid="token">{auth.token ?? "none"}</output>
      <output data-testid="session">{getSessionId()}</output>
      <output data-testid="full">{String(auth.isFullyAuthenticated)}</output>
      <output data-testid="needs-unlock">{String(auth.needsUnlock)}</output>
      <output data-testid="error">{error}</output>
      <button onClick={() => void run(() => auth.setAuthenticated("alice", TOKEN_A, PASSWORD, SALT))}>
        Login A
      </button>
      <button
        onClick={() => void run(() => auth.setAuthenticated("alice", TOKEN_A_LATE, PASSWORD, SALT))}
      >
        Login A delayed
      </button>
      <button onClick={() => void run(() => auth.setAuthenticated("bob", TOKEN_B, PASSWORD, SALT))}>
        Login B
      </button>
      <button onClick={() => void run(() => auth.unlock(PASSWORD))}>Unlock</button>
      <button
        onClick={() => {
          auth.logout();
          redraw((value) => value + 1);
        }}
      >
        Logout
      </button>
    </main>
  );
}

export default function AuthContextHarness() {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
    [],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Harness />
      </AuthProvider>
    </QueryClientProvider>
  );
}
