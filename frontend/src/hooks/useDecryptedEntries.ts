import { useEffect, useRef, useState } from "react";
import { decryptEntry } from "../lib/crypto";
import type { EntryRead } from "../lib/api";
import type { MergedEntry } from "./useEntries";

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
  const seenRef = useRef<Set<string>>(new Set());

  // New KEK → drop all cached plaintext and retry decrypts for this mount.
  useEffect(() => {
    seenRef.current.clear();
    setData({});
    setErrors({});
  }, [kek]);

  const entrySig = entries
    .map((e) => `${e.id}:${(e.encrypted_content ?? "").length}:${(e.encrypted_dek ?? "").length}`)
    .join("|");

  useEffect(() => {
    if (!enabled || !kek) {
      setPending(false);
      return;
    }

    const todo = entries.filter((e) => e.encrypted_content && !seenRef.current.has(e.id));
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
            seenRef.current.add(e.id);
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
  }, [enabled, kek, entrySig]);

  return { data, errors, pending };
}

export type { AnyEntry, MergedEntry };
