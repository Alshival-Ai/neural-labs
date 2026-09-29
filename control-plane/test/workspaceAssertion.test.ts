import { describe, it, expect } from "vitest";
import { workspaceAssertion } from "../src/workspaceAssertion.js";
import { hashToken } from "../src/crypto.js";
// @ts-expect-error The workspace verifier is deliberately plain Node JavaScript.
import { authenticateWorkspaceRequest } from "../../workspace/native/request-auth.mjs";
import type { SessionActor } from "../src/types.js";

describe("workspace proxy assertion", () => {
  it("binds the actor and exact request and does not serialize credentials", () => {
    const actor = { user: { id: "actor", email: "fixture@example.com", role: "admin" }, session: { tokenHash: hashToken("fixture-session") } } as SessionActor;
    const secret = "fixture-only-secret-".repeat(3);
    const signed = workspaceAssertion(actor, secret, "/workspace/api/files?path=sample", "POST", 100)!;
    expect(signed).not.toContain(secret);
    expect(JSON.parse(Buffer.from(signed.split(".")[1]!, "base64url").toString())).toEqual({
      actor: "actor", email: "fixture@example.com", role: "admin", session: hashToken("fixture-session"), uri: "/workspace/api/files?path=sample", method: "POST", expires: 5100 });
    const request = { url: "/workspace/api/files?path=sample", method: "POST", headers: { "x-neural-labs-assertion": signed } };
    expect(authenticateWorkspaceRequest(request, secret, 101).session).toBe(actor.session.tokenHash);
    expect(workspaceAssertion(actor, secret, "/internal/native/request", "POST")).toBeUndefined();
    expect(workspaceAssertion(actor, "short", "/workspace/", "GET")).toBeUndefined();
  });
});
