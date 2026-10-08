import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../context/AuthContext";
import { useDecryptedEntries } from "../hooks/useDecryptedEntries";
import { deriveKEK, encryptEntry } from "../lib/crypto";

function Harness() {
  const [kek, setKek] = useState<CryptoKey | null>(null);
  const [rows, setRows] = useState<{ id: string; encrypted_content: string; encrypted_dek: string }[]>([]);
  const [cipherLength, setCipherLength] = useState(0);
  const result = useDecryptedEntries<{ content: string }>(rows, kek);
  useEffect(() => { void deriveKEK("fictional-test-only", "ab".repeat(16)).then(setKek); }, []);
  async function write(content: string) {
    if (!kek) return;
    const encrypted = await encryptEntry(JSON.stringify({ content }), kek);
    setCipherLength(encrypted.encryptedContent.length);
    setRows([{ id: "same-fictional-entry", encrypted_content: encrypted.encryptedContent, encrypted_dek: encrypted.encryptedDek }]);
  }
  return <div>
    <button disabled={!kek} onClick={() => void write("old")}>Initial</button>
    <button disabled={!kek} onClick={() => void write("new")}>Update</button>
    <button onClick={() => setRows([{ ...rows[0], encrypted_content: "invalid" }])}>Corrupt</button>
    <button onClick={() => setRows([])}>Remove</button>
    <output data-testid="content">{result.data["same-fictional-entry"]?.content ?? "empty"}</output>
    <output data-testid="length">{cipherLength}</output>
    <output data-testid="error">{Object.keys(result.errors).length}</output>
  </div>;
}
export default function DecryptedEntriesHarness() {
  const query = useMemo(() => new QueryClient(), []);
  return <QueryClientProvider client={query}><AuthProvider><Harness /></AuthProvider></QueryClientProvider>;
}
