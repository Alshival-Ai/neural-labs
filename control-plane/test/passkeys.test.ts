import { describe, expect, it } from "vitest";

import { WebAuthnService } from "../src/passkeys.js";
import type { PasskeyRecord, UserRecord } from "../src/types.js";

const now = new Date("2026-09-03T12:00:00.000Z");
const user: UserRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "developer@example.org",
  handle: "developer",
  displayName: "Example Developer",
  role: "user",
  status: "active",
  createdAt: now,
  updatedAt: now,
};
const existing: PasskeyRecord = {
  id: "22222222-2222-4222-8222-222222222222",
  userId: user.id,
  credentialId: "existing-credential",
  webauthnUserId: "existing-user",
  publicKey: new Uint8Array([1, 2, 3]),
  counter: 0,
  deviceType: "multiDevice",
  backedUp: true,
  transports: ["internal"],
  displayName: "Existing passkey",
  createdAt: now,
};

describe("WebAuthn passkey options", () => {
  it("creates discoverable, user-verifying registration options for the configured origin", async () => {
    const result = await new WebAuthnService().registrationOptions(
      new URL("https://neural-labs.example.org"),
      user,
      [existing],
    );

    expect(result.options).toMatchObject({
      rp: { id: "neural-labs.example.org", name: "Neural Labs" },
      user: { name: user.email, displayName: user.displayName },
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      attestation: "none",
      excludeCredentials: [{ id: existing.credentialId, transports: existing.transports }],
    });
  });

  it("creates usernameless authentication options that require user verification", async () => {
    const options = await new WebAuthnService().authenticationOptions(new URL("https://neural-labs.example.org"));
    expect(options).toMatchObject({
      rpId: "neural-labs.example.org",
      allowCredentials: [],
      userVerification: "required",
    });
  });
});
