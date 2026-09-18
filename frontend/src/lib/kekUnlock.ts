import { db } from "../db/offlineQueue";
import { checkKekVerifier, tryUnwrapDek, wrapKekVerifier } from "../lib/crypto";
import { api, type MeResponse } from "../lib/api";

export class KeyUnverifiedError extends Error {
  constructor(message = "kek_unverified") {
    super(message);
    this.name = "KeyUnverifiedError";
  }
}

async function saveLocalVerifier(
  userId: string,
  blob: { encrypted_content: string; encrypted_dek: string },
): Promise<void> {
  await db.kek_verifiers.put({
    owner_user_id: userId,
    encrypted_content: blob.encrypted_content,
    encrypted_dek: blob.encrypted_dek,
    created_at: Date.now(),
  });
}

async function pushServerVerifier(
  token: string,
  blob: { encrypted_content: string; encrypted_dek: string },
): Promise<void> {
  try {
    await api.putKekVerifier(token, blob);
  } catch {
    /* server column may not exist until migration 0004 */
  }
}

async function bootstrapVerifier(kek: CryptoKey, userId: string, token: string): Promise<void> {
  const blob = await wrapKekVerifier(kek);
  await saveLocalVerifier(userId, blob);
  await pushServerVerifier(token, blob);
}

async function localOwnedSample(userId: string) {
  const owned = await db.entries.where("owner_user_id").equals(userId).limit(1).first();
  if (owned) return owned;
  return undefined;
}

export async function establishKek(args: {
  kek: CryptoKey;
  token: string;
  userId: string;
  /** True only after login/register where the password was accepted by the auth server. */
  allowBootstrap: boolean;
}): Promise<"verified" | "wrong_password" | "unverified"> {
  const { kek, token, userId, allowBootstrap } = args;

  const localVerifier = await db.kek_verifiers.get(userId);
  if (localVerifier) {
    const ok = await checkKekVerifier(
      localVerifier.encrypted_content,
      localVerifier.encrypted_dek,
      kek,
    );
    return ok ? "verified" : "wrong_password";
  }

  const localEntry = await localOwnedSample(userId);
  if (localEntry?.encrypted_dek) {
    const ok = await tryUnwrapDek(localEntry.encrypted_dek, kek);
    if (!ok) return "wrong_password";
    await bootstrapVerifier(kek, userId, token);
    return "verified";
  }

  let me: MeResponse | null = null;
  try {
    me = await api.me(token);
  } catch {
    me = null;
  }
  if (me?.encrypted_kek_verifier_content && me.encrypted_kek_verifier_dek) {
    const ok = await checkKekVerifier(
      me.encrypted_kek_verifier_content,
      me.encrypted_kek_verifier_dek,
      kek,
    );
    if (!ok) return "wrong_password";
    await saveLocalVerifier(userId, {
      encrypted_content: me.encrypted_kek_verifier_content,
      encrypted_dek: me.encrypted_kek_verifier_dek,
    });
    return "verified";
  }

  try {
    const remote = await api.listEntries(token, { limit: 1 });
    const sample = remote[0];
    if (sample?.encrypted_dek) {
      const ok = await tryUnwrapDek(sample.encrypted_dek, kek);
      if (!ok) return "wrong_password";
      await bootstrapVerifier(kek, userId, token);
      return "verified";
    }
  } catch {
    /* offline or unauthenticated token */
  }

  if (allowBootstrap) {
    await bootstrapVerifier(kek, userId, token);
    return "verified";
  }

  return "unverified";
}
