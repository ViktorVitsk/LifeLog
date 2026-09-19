/**
 * LifeLog client-side crypto module.
 *
 * Security model:
 *   KEK = PBKDF2(master_password, user_salt, 100_000 iter, SHA-256)  — held in memory only.
 *   DEK = crypto.getRandomValues(32 bytes) per entry                  — never stored plaintext.
 *   encrypted_content = AES-256-GCM(plaintext_json, DEK)
 *   encrypted_dek     = AES-256-GCM(DEK_raw_bytes, KEK)
 *
 * The server stores ciphertext plus open numeric metadata. A stolen database
 * without the password does not reveal diary text. The login password is still
 * sent to the auth server, so this is hybrid encryption, not "the server can
 * never read the diary."
 */

const PBKDF2_ITERATIONS = 100_000;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BITS = 128;

export interface KdfParameters {
  iterations: number;
  hash: "SHA-256";
}

export function kdfParametersForVersion(version: number): KdfParameters {
  if (version === 1) {
    return { iterations: PBKDF2_ITERATIONS, hash: "SHA-256" };
  }
  throw new Error(`unsupported_kdf_version:${version}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Low-level helpers
// ─────────────────────────────────────────────────────────────────────────────

// Note: every helper below returns `Uint8Array<ArrayBuffer>` (NOT the default
// `Uint8Array<ArrayBufferLike>`) so the results satisfy the stricter
// `BufferSource = ArrayBufferView<ArrayBuffer>` constraint that Web Crypto
// parameter types use in modern lib.dom.d.ts.
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string length");
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function concatBytes(
  a: Uint8Array,
  b: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(a.length + b.length));
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Key derivation and generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive the Key Encryption Key (KEK) from the master password + user salt.
 * Run ONCE on login. Keep result only in React state (memory).
 *
 * A future version 2 must be activated only after the user enters the password:
 * derive and verify v1, derive v2, then wrap a transiently exportable v1 KEK
 * with v2 into a dedicated opaque migration envelope before the server switches
 * `kdf_version`. Existing `encrypted_dek` values and content stay untouched.
 * The envelope needs its own schema migration; changing only `kdf_version`
 * would make existing data undecryptable.
 */
export async function deriveKEK(
  password: string,
  saltHex: string,
  kdfVersion = 1,
): Promise<CryptoKey> {
  const parameters = kdfParametersForVersion(kdfVersion);
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: hexToBytes(saltHex),
      iterations: parameters.iterations,
      hash: parameters.hash,
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable: can't be read back out of memory
    ["wrapKey", "unwrapKey", "encrypt", "decrypt"],
  );
}

/**
 * Generate a random Data Encryption Key (DEK) for a new entry.
 * Marked extractable so we can wrap its raw bytes with the KEK.
 */
export async function generateDEK(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Encryption / decryption
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt an entry's plaintext JSON for storage on the server.
 *
 * Output layout for each ciphertext field (base64):
 *   [IV (12 bytes) | ciphertext + AES-GCM tag (16 bytes)]
 */
export async function encryptEntry(
  plaintextJson: string,
  kek: CryptoKey,
): Promise<{ encryptedContent: string; encryptedDek: string }> {
  // 1. Generate a fresh DEK for this entry.
  const dek = await generateDEK();
  const dekRaw = new Uint8Array(await crypto.subtle.exportKey("raw", dek));

  // 2. Encrypt the plaintext with the DEK.
  const contentIv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const contentCipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: contentIv, tagLength: AES_GCM_TAG_BITS },
      dek,
      new TextEncoder().encode(plaintextJson),
    ),
  );

  // 3. Wrap the DEK's raw bytes with the KEK.
  const dekIv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const dekCipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: dekIv, tagLength: AES_GCM_TAG_BITS },
      kek,
      dekRaw,
    ),
  );

  return {
    encryptedContent: bytesToBase64(concatBytes(contentIv, contentCipher)),
    encryptedDek: bytesToBase64(concatBytes(dekIv, dekCipher)),
  };
}

/**
 * Decrypt an entry previously returned by the server.
 */
/**
 * Lightweight password verification: tries to unwrap the DEK from one of
 * the user's existing entries with the given KEK. Returns true on success.
 *
 * Used by the "re-enter master password after refresh" flow so we can tell
 * the user immediately if they typed the wrong password instead of silently
 * storing a bad KEK that would later fail on first decrypt attempt.
 */
export async function tryUnwrapDek(
  encryptedDek: string,
  kek: CryptoKey,
): Promise<boolean> {
  try {
    const blob = base64ToBytes(encryptedDek);
    const iv = blob.slice(0, AES_GCM_IV_BYTES);
    const cipher = blob.slice(AES_GCM_IV_BYTES);
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: AES_GCM_TAG_BITS },
      kek,
      cipher,
    );
    return true;
  } catch {
    return false;
  }
}

export async function decryptEntry(
  encryptedContent: string,
  encryptedDek: string,
  kek: CryptoKey,
): Promise<string> {
  // 1. Unwrap the DEK using the KEK.
  const dekBlob = base64ToBytes(encryptedDek);
  const dekIv = dekBlob.slice(0, AES_GCM_IV_BYTES);
  const dekCipher = dekBlob.slice(AES_GCM_IV_BYTES);
  const dekRaw = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: dekIv, tagLength: AES_GCM_TAG_BITS },
      kek,
      dekCipher,
    ),
  );
  const dek = await crypto.subtle.importKey(
    "raw",
    dekRaw,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  // 2. Decrypt the content with the DEK.
  const contentBlob = base64ToBytes(encryptedContent);
  const contentIv = contentBlob.slice(0, AES_GCM_IV_BYTES);
  const contentCipher = contentBlob.slice(AES_GCM_IV_BYTES);
  const plaintextBytes = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: contentIv, tagLength: AES_GCM_TAG_BITS },
      dek,
      contentCipher,
    ),
  );

  return new TextDecoder().decode(plaintextBytes);
}

export const KEK_VERIFIER_PAYLOAD = "lifelog-kek-verifier-v1";

export async function wrapKekVerifier(
  kek: CryptoKey,
): Promise<{ encrypted_content: string; encrypted_dek: string }> {
  const { encryptedContent, encryptedDek } = await encryptEntry(
    JSON.stringify({ v: 1, kind: "kek_verifier", payload: KEK_VERIFIER_PAYLOAD }),
    kek,
  );
  return { encrypted_content: encryptedContent, encrypted_dek: encryptedDek };
}

export async function checkKekVerifier(
  encryptedContent: string,
  encryptedDek: string,
  kek: CryptoKey,
): Promise<boolean> {
  try {
    const raw = await decryptEntry(encryptedContent, encryptedDek, kek);
    const parsed = JSON.parse(raw) as { payload?: string };
    return parsed.payload === KEK_VERIFIER_PAYLOAD;
  } catch {
    return false;
  }
}
