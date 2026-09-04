import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig, parsePublicOrigin } from "../src/config.js";

async function secretFiles() {
  const directory = await mkdtemp(path.join(tmpdir(), "neural-labs-control-config-"));
  const master = path.join(directory, "master");
  const database = path.join(directory, "database");
  const mcp = path.join(directory, "mcp");
  const workspace = path.join(directory, "workspace");
  await writeFile(master, Buffer.alloc(32, 7).toString("base64"));
  await writeFile(database, "database-password");
  await writeFile(mcp, "mcp-config-token-at-least-thirty-two-characters");
  await writeFile(workspace, "workspace-control-token-at-least-thirty-two-characters");
  return { master, database, mcp, workspace };
}

describe("control-plane configuration", () => {
  it("loads runtime secrets from files", async () => {
    const files = await secretFiles();
    const config = await loadConfig({
      CONTROL_PLANE_MASTER_KEY_FILE: files.master,
      MCP_CONFIG_TOKEN_FILE: files.mcp,
      WORKSPACE_CONTROL_TOKEN_FILE: files.workspace,
      PGPASSWORD_FILE: files.database,
      CONTROL_PLANE_PUBLIC_ORIGIN: "https://neural-labs.example.com",
    });

    expect(config.masterKey).toHaveLength(32);
    expect(config.database.password).toBe("database-password");
    expect(config.publicOrigin?.origin).toBe("https://neural-labs.example.com");
    expect(config.autoSetup).toBe(false);
    expect(config.setupDefaults.localAuthEnabled).toBe(true);
    expect(config.workspace).toMatchObject({
      openclawVersion: "2026.8.2",
      codexVersion: "0.152.0",
    });
    expect(config.secureCookies).toBe(true);
  });

  it("loads runtime secrets directly from a protected environment", async () => {
    const config = await loadConfig({
      CONTROL_PLANE_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
      MCP_CONFIG_TOKEN: "mcp-config-token-at-least-thirty-two-characters",
      WORKSPACE_CONTROL_TOKEN: "workspace-control-token-at-least-thirty-two-characters",
      PGPASSWORD: "database-password",
      CONTROL_PLANE_PUBLIC_ORIGIN: "https://neural-labs.example.com",
      CONTROL_PLANE_TURN_URLS: "stun:neural-labs.example.com:3478,turn:neural-labs.example.com:3478?transport=udp",
      CONTROL_PLANE_TURN_SECRET: "turn-secret-at-least-thirty-two-characters",
    });

    expect(config.masterKey).toHaveLength(32);
    expect(config.database.password).toBe("database-password");
    expect(config.mcpConfigToken).toBe("mcp-config-token-at-least-thirty-two-characters");
    expect(config.turn?.urls).toHaveLength(2);
    expect(config.turn?.secret).toBe("turn-secret-at-least-thirty-two-characters");
  });

  it("loads automatic environment setup and the restricted initial administrator", async () => {
    const files = await secretFiles();
    const config = await loadConfig({
      CONTROL_PLANE_MASTER_KEY_FILE: files.master,
      MCP_CONFIG_TOKEN_FILE: files.mcp,
      WORKSPACE_CONTROL_TOKEN_FILE: files.workspace,
      PGPASSWORD_FILE: files.database,
      CONTROL_PLANE_PUBLIC_ORIGIN: "https://neural-labs.example.com",
      CONTROL_PLANE_AUTO_SETUP: "true",
      CONTROL_PLANE_INITIAL_ADMIN_EMAIL: "Admin@Example.org",
      CONTROL_PLANE_DEFAULT_LOCAL_AUTH_ENABLED: "true",
      CONTROL_PLANE_DEFAULT_MICROSOFT_AUTH_ENABLED: "false",
      CONTROL_PLANE_DEFAULT_MCP_ENABLED: "false",
    });

    expect(config.autoSetup).toBe(true);
    expect(config.initialAdminEmail).toBe("admin@example.org");
  });

  it("accepts HTTP only for loopback public origins", () => {
    expect(parsePublicOrigin("http://127.0.0.1:4174").origin).toBe("http://127.0.0.1:4174");
    expect(() => parsePublicOrigin("http://example.com")).toThrow(/HTTPS/);
    expect(() => parsePublicOrigin("https://example.com/path")).toThrow(/only scheme/);
  });

  it("rejects partial environment Entra configuration", async () => {
    const files = await secretFiles();
    await expect(
      loadConfig({
        CONTROL_PLANE_MASTER_KEY_FILE: files.master,
        MCP_CONFIG_TOKEN_FILE: files.mcp,
        WORKSPACE_CONTROL_TOKEN_FILE: files.workspace,
        PGPASSWORD_FILE: files.database,
        AZURE_TENANT_ID: "tenant-only",
      }),
    ).rejects.toThrow(/AZURE_CLIENT_ID/);
  });
});
