import { useEffect, useState, type ReactNode } from "react";
import { decryptEntry } from "../lib/crypto";
import { getSessionId, isCurrentSession } from "../lib/accountScope";

export function useDecryptedJson(
  kek: CryptoKey | null,
  dek: string,
  ct: string,
): Record<string, unknown> | null {
  const [plain, setPlain] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPlain(null);
    if (!kek || !dek || !ct) return;
    const session = getSessionId();
    void decryptEntry(ct, dek, kek)
      .then((raw) => {
        if (cancelled || !isCurrentSession(session)) return;
        setPlain(JSON.parse(raw) as Record<string, unknown>);
      })
      .catch(() => {
        if (cancelled || !isCurrentSession(session)) return;
        setPlain({});
      });
    return () => {
      cancelled = true;
    };
  }, [kek, dek, ct]);

  return plain;
}

export function useDecryptedMap(
  items: { id: string; encrypted_dek: string; encrypted_content: string }[],
  kek: CryptoKey | null,
): Record<string, Record<string, unknown>> {
  const [map, setMap] = useState<Record<string, Record<string, unknown>>>({});
  const key = items.map((item) => `${item.id}:${item.encrypted_content}`).join("|");

  useEffect(() => {
    let cancelled = false;
    const session = getSessionId();
    if (!kek) {
      setMap({});
      return;
    }
    void (async () => {
      const next: Record<string, Record<string, unknown>> = {};
      for (const item of items) {
        try {
          const raw = await decryptEntry(item.encrypted_content, item.encrypted_dek, kek);
          next[item.id] = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          next[item.id] = {};
        }
      }
      if (!cancelled && isCurrentSession(session)) setMap(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [kek, key]);

  return map;
}

export default function CipherCard({
  kek,
  dek,
  ct,
  fallback,
  children,
}: {
  kek: CryptoKey | null;
  dek: string;
  ct: string;
  fallback: string;
  children: (plain: Record<string, unknown>) => ReactNode;
}) {
  const plain = useDecryptedJson(kek, dek, ct);
  if (!kek) return <div className="text-xs text-zinc-500">{fallback}</div>;
  if (!plain) return <div className="text-xs text-zinc-500">…</div>;
  return <>{children(plain)}</>;
}
