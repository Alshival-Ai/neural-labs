import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { AlshivalConnection } from "../src/alshivalConnection.js";
import type { Database } from "../src/database.js";
import type { ControlPlaneConfig } from "../src/config.js";

function fixture() {
  const records = new Map<string, { encrypted_credentials: string | null; enabled: boolean; revision: number }>();
  const query = vi.fn(async (sql: string, args: any[]) => {
    const row = records.get(args[0]);
    if (sql.startsWith("SELECT")) return { rows: row?.enabled ? [row] : [], rowCount: row?.enabled ? 1 : 0 };
    if (sql.startsWith("INSERT")) records.set(args[0], { encrypted_credentials: args[1], enabled: true, revision: (row?.revision || 0) + 1 });
    else if (sql.includes("enabled=false")) { if (row) { row.enabled = false; row.encrypted_credentials = null; row.revision++; } }
    else {
      if (!row?.enabled || row.revision !== args[2]) return { rows: [], rowCount: 0 };
      row.encrypted_credentials = args[1]; row.revision++;
    }
    return { rows: [], rowCount: 1 };
  });
  const config = { masterKey: Buffer.alloc(32, 7), publicOrigin: new URL("https://labs.example.test") } as ControlPlaneConfig;
  return { connection: new AlshivalConnection({ pool: { query } } as unknown as Database, config), records };
}
afterEach(() => vi.unstubAllGlobals());
describe("personal Alshival OAuth", () => {
  it("binds PKCE and callback state to one user and encrypts credentials", async () => {
    const f = fixture();
    const fetch = vi.fn(async () => Response.json({ client_id: "test-client" })); vi.stubGlobal("fetch", fetch);
    const url = new URL((await f.connection.connect("alice")).url);
    const row = await f.connection.load("alice");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(row!.credential.pending!.verifier).digest("base64url"));
    expect(url.searchParams.get("resource")).toBe("https://mcp.alshival.ai/workspace/mcp/");
    expect(f.records.get("alshival:alice")!.encrypted_credentials).not.toContain(row!.credential.pending!.verifier);
    await expect(f.connection.complete("bob", url.searchParams.get("state")!, "code")).rejects.toThrow("expired");
    await expect(f.connection.complete("alice", "wrong", "code")).rejects.toThrow("expired");
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(Response.json({ access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600 }));
    await f.connection.complete("alice", url.searchParams.get("state")!, "code");
    expect((await f.connection.status("alice")).ready).toBe(true);
    expect((await f.connection.status("bob")).ready).toBe(false);
    await expect(f.connection.complete("alice", url.searchParams.get("state")!, "code")).rejects.toThrow("expired");
  });
  it("does not resurrect a connection disconnected during token exchange", async () => {
    const f = fixture();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ client_id: "test-client" })));
    const url = new URL((await f.connection.connect("alice")).url);
    vi.stubGlobal("fetch", vi.fn(async () => { await f.connection.disconnect("alice"); return Response.json({ access_token: "test-access" }); }));
    await expect(f.connection.complete("alice", url.searchParams.get("state")!, "code")).rejects.toThrow("changed");
    expect(await f.connection.load("alice")).toBeUndefined();
  });
  it("discards an in-flight result after disconnect", async () => {
    const f = fixture();
    await f.connection.save("alice", { client: "test-client", access: "test-access", expires: Date.now() + 3600000 });
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.method === "tools/list") await f.connection.disconnect("alice");
      return Response.json({ jsonrpc: "2.0", id: body.id, result: {} });
    }));
    await expect(f.connection.invoke("alice", "tools/list", {})).rejects.toThrow("revoked");
  });
});
