import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CredentialCipher,
  hashPassword,
  hashToken,
  normalizeCertificateCredential,
  normalizeEmail,
  verifyPassword,
} from "../src/crypto.js";

describe("credential cryptography", () => {
  it("round-trips encrypted credentials without exposing plaintext", () => {
    const cipher = new CredentialCipher(randomBytes(32));
    const encrypted = cipher.encrypt({ type: "secret", clientSecret: "do-not-log-me" });

    expect(encrypted).not.toContain("do-not-log-me");
    expect(cipher.decrypt(encrypted)).toEqual({ type: "secret", clientSecret: "do-not-log-me" });
  });

  it("rejects tampered ciphertext", () => {
    const cipher = new CredentialCipher(randomBytes(32));
    const parsed = JSON.parse(cipher.encrypt({ type: "secret", clientSecret: "secret" })) as {
      ciphertext: string;
    };
    parsed.ciphertext = `${parsed.ciphertext.slice(0, -2)}aa`;
    expect(() => cipher.decrypt(JSON.stringify(parsed))).toThrow();
  });

  it("hashes and verifies local passwords", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toContain("correct horse");
    await expect(verifyPassword(hash, "correct horse battery staple")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong password")).resolves.toBe(false);
  });

  it("normalizes account identifiers and hashes tokens deterministically", () => {
    expect(normalizeEmail("  Admin@Example.COM ")).toBe("admin@example.com");
    expect(hashToken("token")).toBe(hashToken("token"));
    expect(hashToken("token")).not.toBe(hashToken("other"));
  });

  it("rejects PEM uploads without both certificate and private key", () => {
    expect(() => normalizeCertificateCredential("not a credential")).toThrow(
      /certificate and private key/,
    );
  });
});
