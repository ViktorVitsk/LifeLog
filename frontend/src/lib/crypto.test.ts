import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kdfParametersForVersion } from "./crypto.ts";

describe("KDF version selection", () => {
  it("keeps version 1 at the existing PBKDF2 parameters", () => {
    assert.deepEqual(kdfParametersForVersion(1), {
      iterations: 100_000,
      hash: "SHA-256",
    });
  });

  it("rejects unknown versions instead of guessing parameters", () => {
    assert.throws(() => kdfParametersForVersion(2), /unsupported_kdf_version/);
  });
});
