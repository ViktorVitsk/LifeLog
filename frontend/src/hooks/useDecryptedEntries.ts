import { useEffect, useRef, useState } from "react";
import { decryptEntry } from "../lib/crypto";
import type { EntryRead } from "../lib/api";
import type { MergedEntry } from "./useEntries";
import { useAuth } from "../context/AuthContext";

type AnyEntry = Pick<EntryRead, "id" | "encrypted_content" | "encrypted_dek">;

export interface DecryptedMap<T> {
  data: Record<string, T>;
  errors: Record<string, string>;
  pending: boolean;
}

/**
 * Decrypts a batch of entries client-side into a stable { id → payload } map.
 *
 * Correctness notes (bugs we fixed):
 *   - **Never** mark an id as "seen" before decrypt succeeds. Eager `seen`
 *     + React Strict Mode cancelling the first in-flight batch left ids stuck
 *     unseen forever → UI showed "(empty)" for Gratitude and similar.
 *   - When the KEK changes (login / unlock), clear the cache so everything
 *     re-decrypts with the new key.
 */
export function useDecryptedEntries<T = Record<string, unknown>>(
  entries: AnyEntry[],
  kek: CryptoKey | null,
  enabled = true,
): DecryptedMap<T> {
  const [data, setData] = useState<Record<string, T>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const seenRef = useRef<Map<string, string>>(new Map());
  const { userId } = useAuth();

  // New KEK or account → drop cached plaintext.
  useEffect(() => {
    seenRef.current.clear();
    setData({});
    setErrors({});
  }, [kek, userId]);

  const entrySig = entries
    .map((e) => `${e.id}:${e.encrypted_content}:${e.encrypted_dek}`)
    .join("|");

  useEffect(() => {
    if (!enabled || !kek) {
      setPending(false);
      return;
    }

    // A same-ID update can have ciphertext of exactly the same length.
    // Cache the envelope identity, not just ID/length, and discard old plaintext.
    const todo = entries.filter((e) => e.encrypted_content && seenRef.current.get(e.id) !== `${e.encrypted_content}:${e.encrypted_dek}`);
    const validIds = new Set(entries.filter((e) => seenRef.current.get(e.id) === `${e.encrypted_content}:${e.encrypted_dek}`).map((e) => e.id));
    for (const id of seenRef.current.keys()) if (!validIds.has(id)) seenRef.current.delete(id);
    setData((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => validIds.has(id))));
    setErrors({});
    if (todo.length === 0) {
      setPending(false);
      return;
    }

    let cancelled = false;
    setPending(true);

    void (async () => {
      const newData: Record<string, T> = {};
      const newErrors: Record<string, string> = {};

      await Promise.all(
        todo.map(async (e) => {
          try {
            const json = await decryptEntry(e.encrypted_content, e.encrypted_dek, kek);
            if (cancelled) return;
            newData[e.id] = JSON.parse(json) as T;
            seenRef.current.set(e.id, `${e.encrypted_content}:${e.encrypted_dek}`);
          } catch (err) {
            if (cancelled) return;
            newErrors[e.id] = (err as Error).message;
          }
        }),
      );

      if (cancelled) return;
      setData((prev) => ({ ...prev, ...newData }));
      if (Object.keys(newErrors).length > 0) {
        setErrors((prev) => ({ ...prev, ...newErrors }));
      }
      setPending(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, kek, userId, entrySig]);

  return { data, errors, pending };
}

export type { AnyEntry, MergedEntry };
