import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const providers = {
  setupComplete: true,
  local: { available: true, enabled: true },
  microsoft: { available: true, enabled: true, source: "environment" },
};

const activeUser = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "developer@example.org",
  displayName: "Developer",
  role: "user",
  status: "active",
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
};

describe("control-plane account console", () => {
  it("renders the enabled login providers", async () => {
    window.history.replaceState({}, "", "/login");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/session") return json({ authenticated: false });
      if (url === "/api/auth/providers") return json(providers);
      return json({ error: { message: "not found" } }, 404);
    });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in with Microsoft" })).toBeInTheDocument();
  });

  it("keeps the shared-workspace handoff for an active user", async () => {
    window.history.replaceState({}, "", "/workspace");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/session") return json({ authenticated: true, user: activeUser, providers: ["local"], csrfToken: "csrf-token" });
      if (url === "/api/auth/providers") return json(providers);
      if (url === "/api/workspace") return json({ available: true, shared: true, persistent: true, status: "ready", publicUrl: "/workspace", openclawVersion: "2026.8.2", codexVersion: "0.152.0", codexAuthenticated: true, openclawModelReady: true });
      return json({ error: { message: "not found" } }, 404);
    });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Workspace" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Launch OpenClaw" })).toHaveAttribute("href", "/workspace");
    expect(screen.queryByRole("link", { name: /Admin console/ })).not.toBeInTheDocument();
  });
});
