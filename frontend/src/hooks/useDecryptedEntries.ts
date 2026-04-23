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
 * Scope of Phase 3:
 *   - Used by the Psychology page for eager decryption of Gratitude entries
 *     (short lists) and for lazy per-entry decryption from the Emotional
 *     History list.
 *   - Results are cached by id for the lifetime of this hook's mount — we
 *     only decrypt ids we haven't seen yet, so scrolling / re-renders are
 *     free after the first pass.
 *
 * Invariants:
 *   - If `kek` is null we return an empty map and never call the crypto
 *     layer (the UI should render an "unlock required" state instead).
 *   - We silently drop rows whose ciphertext fails to decrypt; the caller
 *     can check `errors` if it wants to surface that.
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

    (async () => {
      const newData: Record<string, T> = {};
      const newErrors: Record<string, string> = {};
      // Mark ids as seen eagerly to avoid re-decrypting on rapid re-renders
      // even if this batch errors — errors are surfaced through `errors`.
      for (const e of todo) seenRef.current.add(e.id);

      await Promise.all(
        todo.map(async (e) => {
          try {
            const json = await decryptEntry(e.encrypted_content, e.encrypted_dek, kek);
            newData[e.id] = JSON.parse(json) as T;
          } catch (err) {
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
    // We intentionally depend on a stable signature of ids; entries array
    // identity changes on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, kek, entries.map((e) => e.id).join(",")]);

  return { data, errors, pending };
}

export type { AnyEntry, MergedEntry };
