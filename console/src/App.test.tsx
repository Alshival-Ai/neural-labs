import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => true,
  startAuthentication: vi.fn(),
}));

import { startAuthentication } from "@simplewebauthn/browser";
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
  passkey: { available: true, enabled: true },
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
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    const brand = screen.getByRole("link", { name: "Neural Labs landing page" });
    expect(brand).toHaveTextContent("Neural Labs");
    expect(brand.querySelector("img")).toBeNull();
    expect(brand.querySelector(".brand-wordmark")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "developer@example.org" } });
    screen.getByRole("button", { name: "Continue" }).click();
    expect(await screen.findByRole("button", { name: "Use a passkey" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use your password" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in with Microsoft" })).toBeInTheDocument();
    expect(screen.queryByText("Loading Neural Labs", { selector: ".loading-screen" })).not.toBeInTheDocument();
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

  it("runs the passkey ceremony and submits its one-use transaction", async () => {
    window.history.replaceState({}, "", "/login");
    vi.mocked(startAuthentication).mockResolvedValue({
      id: "credential-id",
      rawId: "credential-id",
      type: "public-key",
      response: { clientDataJSON: "client-data", authenticatorData: "authenticator-data", signature: "signature", userHandle: "user-id" },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/session") return json({ authenticated: false });
      if (url === "/api/auth/providers") return json(providers);
      if (url === "/api/auth/passkey/options" && init?.method === "POST") return json({
        transaction: "one-use-transaction",
        options: { challenge: "challenge", rpId: "example.org", allowCredentials: [], userVerification: "required" },
      });
      if (url === "/api/auth/passkey/verify" && init?.method === "POST") {
        return json({ error: { code: "passkey_invalid", message: "Test verification stopped." } }, 401);
      }
      return json({ error: { message: "not found" } }, 404);
    });

    render(<App />);
    fireEvent.change(await screen.findByLabelText("Email address"), { target: { value: "developer@example.org" } });
    screen.getByRole("button", { name: "Continue" }).click();
    (await screen.findByRole("button", { name: "Use a passkey" })).click();

    expect(await screen.findByText("Test verification stopped.")).toBeInTheDocument();
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: expect.objectContaining({ challenge: "challenge" }) });
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/passkey/verify",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"transaction":"one-use-transaction"'),
      }),
    );
  });

  it("reveals password sign-in only after the email step", async () => {
    window.history.replaceState({}, "", "/login");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/session") return json({ authenticated: false });
      if (url === "/api/auth/providers") return json(providers);
      return json({ error: { message: "not found" } }, 404);
    });

    render(<App />);
    fireEvent.change(await screen.findByLabelText("Email address"), { target: { value: "developer@example.org" } });
    screen.getByRole("button", { name: "Continue" }).click();
    screen.getByRole("button", { name: "Use your password" }).click();

    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose another method" })).toBeInTheDocument();
  });

  it("checks password confirmation before requesting local access", async () => {
    window.history.replaceState({}, "", "/signup");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/session") return json({ authenticated: false });
      if (url === "/api/auth/providers") return json(providers);
      return json({ error: { message: "not found" } }, 404);
    });

    render(<App />);
    fireEvent.change(await screen.findByLabelText("Display name"), { target: { value: "Test User" } });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "test@example.org" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-strong-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "a-different-password" } });
    screen.getByRole("button", { name: "Request access" }).click();

    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/auth/local/signup", expect.anything());
    expect(screen.getByRole("link", { name: "Sign in with Microsoft" })).toBeInTheDocument();
  });
});
