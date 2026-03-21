import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "a".repeat(64); // 32 bytes as hex
});

// Dynamic import so ENCRYPTION_KEY is set before module evaluation
const { encrypt, decrypt } = await import("../../src/server/crypto.js");

describe("encrypt/decrypt", () => {
  it("round-trips a simple string", () => {
    const plaintext = "hello world";

    const ciphertext = encrypt(plaintext);

    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("round-trips different payloads", () => {
    const payloads = ["", "a".repeat(1000), '{"key":"value"}', "unicode: 你好"];

    for (const payload of payloads) {
      expect(decrypt(encrypt(payload))).toBe(payload);
    }
  });

  it("produces different ciphertexts for same plaintext (unique IVs)", () => {
    const plaintext = "same input";

    const c1 = encrypt(plaintext);
    const c2 = encrypt(plaintext);

    expect(c1).not.toBe(c2);
  });

  it("ciphertext format is two colon-separated hex parts", () => {
    const ciphertext = encrypt("test");

    const parts = ciphertext.split(":");

    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^[0-9a-f]+$/);
    expect(parts[1]).toMatch(/^[0-9a-f]+$/);
  });
});
