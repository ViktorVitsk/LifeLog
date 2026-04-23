import { useState } from "react";
import { deriveKEK } from "../lib/crypto";

/**
 * Holds the JWT access token and the in-memory KEK.
 *
 * IMPORTANT: KEK is NEVER written to localStorage / sessionStorage.
 * On page refresh the user must re-enter the master password.
 */
export interface AuthState {
  token: string | null;
  kek: CryptoKey | null;
  username: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    token: null,
    kek: null,
    username: null,
  });

  async function setAuthenticated(
    username: string,
    token: string,
    password: string,
    saltHex: string,
  ): Promise<void> {
    const kek = await deriveKEK(password, saltHex);
    setState({ token, kek, username });
  }

  function logout() {
    setState({ token: null, kek: null, username: null });
  }

  return { ...state, setAuthenticated, logout };
}
