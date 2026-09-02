import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsApp } from "./SettingsApp";

const admin = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.org",
  handle: "admin-user",
  displayName: "Admin User",
  role: "admin",
  status: "active",
  providers: ["local"],
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
};

const pending = {
  ...admin,
  id: "22222222-2222-4222-8222-222222222222",
  email: "new@example.org",
  handle: "new-developer",
  displayName: "New Developer",
  role: "user",
  status: "pending",
  providers: ["microsoft"],
};

const workspace = {
  available: true,
  shared: true,
  persistent: true,
  status: "ready",
  publicUrl: "https://neural-labs.example.org/workspace",
  openclawVersion: "2026.8.2",
  codexVersion: "0.152.0",
  codexAuthenticated: false,
  openclawModelReady: false,
};

const mcp = {
  enabled: false,
  available: true,
  configured: false,
  configVersion: 3,
  publicUrl: "https://neural-labs.example.org/mcp",
  protectedResourceMetadataUrl: "https://neural-labs.example.org/.well-known/oauth-protected-resource/mcp",
  authorizationServerMetadataUrl: "https://neural-labs.example.org/.well-known/oauth-authorization-server",
  oauthScope: "api://client/mcp.access",
  requiredScope: "mcp.access",
  tokenAudience: "client",
};

const overview = {
  counts: { pending: 1, active: 1, activeAdmins: 1, inactive: 0 },
  authentication: { localEnabled: true, microsoftEnabled: true, microsoftAvailable: true, microsoftSource: "environment" },
  mcp,
  workspace,
  recentAudit: [],
};

const authentication = {
  localAuthEnabled: true,
  microsoftAuthEnabled: true,
  microsoftAvailable: true,
  microsoftSource: "environment",
  callbackUrl: "https://neural-labs.example.org/auth/microsoft/callback",
  entra: {
    tenantId: "tenant-id",
    clientId: "client-id",
    authorityHost: "https://login.microsoftonline.com",
    credentialType: "secret",
    certificateExpiresAt: null,
    certificateThumbprint: null,
  },
  updatedAt: "2026-09-01T12:00:00.000Z",
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/auth/providers") return json({ local: { enabled: true }, microsoft: { available: true, enabled: true } });
    if (url === "/api/admin/overview") return json(overview);
    if (url === "/api/admin/users" && method === "GET") return json({ users: [admin, pending] });
    if (url.endsWith(`/api/admin/users/${pending.id}`) && method === "PATCH") {
      return json({ user: { ...pending, status: "active", providers: undefined } });
    }
    if (url === "/api/admin/authentication" && method === "GET") return json(authentication);
    if (url === "/api/admin/authentication" && method === "PUT") return json({ ...authentication, localAuthEnabled: false, updatedAt: "2026-09-01T12:01:00.000Z" });
    if (url === "/api/admin/mcp" && method === "GET") return json(mcp);
    if (url === "/api/admin/mcp" && method === "PUT") return json({ ...mcp, enabled: true, configured: true });
    if (url === "/api/workspace") return json(workspace);
    if (url === "/api/admin/workspace/provider" && method === "GET") return json({ provider: "openai", authMethod: "chatgpt", state: "disconnected", authenticated: false, modelReady: false, verificationUrl: null, userCode: null, expiresAt: null, message: null });
    if (url === "/api/admin/workspace/provider/connect" && method === "POST") return json({ provider: "openai", authMethod: "chatgpt", state: "starting", authenticated: false, modelReady: false, verificationUrl: null, userCode: null, expiresAt: null, message: null }, 202);
    if (url === "/api/admin/audit?limit=100") return json({ events: [] });
    return json({ error: { message: `Unexpected ${method} ${url}` } }, 500);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Settings app", () => {
  it("shows only Personalization to members without requesting admin data", async () => {
    const member = { ...admin, role: "user" as const, status: "active" as const, providers: ["local" as const] };
    render(<SettingsApp administrator={false} csrfToken="csrf-token" currentUserId={member.id} user={member} providers={["local"]} fontScale={100} onFontScaleChange={vi.fn()} onLogout={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Personalization" })).toBeInTheDocument();
    expect(screen.getByText("Personal", { selector: ".settings-toolbar__scope" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Overview/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Users/ })).not.toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/auth/providers", expect.anything()));
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith("/api/admin/"))).toBe(false);
  });

  it("loads the control-plane overview and approves a pending user with CSRF", async () => {
    render(<SettingsApp csrfToken="csrf-token" currentUserId={admin.id} />);

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pending requests/ })).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: /^Users/ }));
    expect(await screen.findByText("New Developer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/admin/users/${pending.id}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "active" }),
        headers: expect.any(Headers),
      }),
    ));
    const request = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith(pending.id));
    expect(new Headers(request?.[1]?.headers).get("X-CSRF-Token")).toBe("csrf-token");
    expect(await screen.findByText("New Developer was updated.")).toBeInTheDocument();
  });

  it("persists authentication and MCP changes through the live admin APIs", async () => {
    const { unmount } = render(<SettingsApp csrfToken="csrf-token" currentUserId={admin.id} initialSection="authentication" />);
    const localLogin = await screen.findByRole("checkbox", { name: /Local login/ });
    fireEvent.click(localLogin);
    fireEvent.click(screen.getByRole("button", { name: "Save login settings" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/admin/authentication",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ localAuthEnabled: false, microsoftAuthEnabled: true }) }),
    ));

    unmount();
    render(<SettingsApp csrfToken="csrf-token" currentUserId={admin.id} initialSection="mcp" />);
    const mcpToggle = await screen.findByRole("checkbox", { name: /Enable MCP access/ });
    fireEvent.click(mcpToggle);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/admin/mcp",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ enabled: true }) }),
    ));
  });

  it("starts workspace-owned ChatGPT pairing", async () => {
    render(<SettingsApp csrfToken="csrf-token" currentUserId={admin.id} initialSection="workspace" />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect ChatGPT account" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/admin/workspace/provider/connect",
      expect.objectContaining({ method: "POST", body: JSON.stringify({}) }),
    ));
  });
});
