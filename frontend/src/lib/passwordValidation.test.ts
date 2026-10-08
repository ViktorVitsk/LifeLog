import assert from "node:assert/strict";
import { it } from "node:test";
import { registrationPasswordTooLong } from "./passwordValidation.ts";

it("measures the registration limit in UTF-8 bytes without modifying input", () => {
  assert.equal(registrationPasswordTooLong("a".repeat(72)), false);
  assert.equal(registrationPasswordTooLong("a".repeat(73)), true);
  assert.equal(registrationPasswordTooLong("я".repeat(36)), false);
  assert.equal(registrationPasswordTooLong("я".repeat(37)), true);
  assert.equal(registrationPasswordTooLong("😀".repeat(19)), true);
});
