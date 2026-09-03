import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => true,
  startRegistration: vi.fn(),
}));

import { startRegistration } from "@simplewebauthn/browser";

import { PersonalizationPanel, type PersonalOpenAIAuth } from "./UserSettingsApp";

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "developer@example.org",
  handle: "developer",
  displayName: "Example Developer",
  role: "user" as const,
  status: "active" as const,
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

const openAI: PersonalOpenAIAuth = {
  provider: "openai",
  authMethod: "chatgpt",
  state: "disconnected",
  authenticated: false,
  modelReady: false,
  verificationUrl: null,
  userCode: null,
  expiresAt: null,
  message: null,
  agentId: "nl-11111111111141118111111111111111",
  paused: true,
};

const createdPasskey = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "My passkey",
  deviceType: "multiDevice",
  backedUp: true,
  createdAt: "2026-09-03T12:00:00.000Z",
  lastUsedAt: null,
};

beforeEach(() => {
  let currentOpenAI = { ...openAI };
  let passkeys: typeof createdPasskey[] = [];
  vi.mocked(startRegistration).mockResolvedValue({
    id: "credential-id",
    rawId: "credential-id",
    type: "public-key",
    response: { clientDataJSON: "client-data", attestationObject: "attestation", transports: ["internal"] },
    clientExtensionResults: {},
    authenticatorAttachment: "platform",
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/auth/providers") {
      return json({ local: { enabled: true }, microsoft: { available: true, enabled: true } });
    }
    if (url === "/api/account/openai" && !init?.method) return json(currentOpenAI);
    if (url === "/api/account/passkeys" && !init?.method) return json({ eligible: true, passkeys });
    if (url === "/api/account/passkeys/registration/options" && init?.method === "POST") return json({
      transaction: "passkey-transaction-token",
      options: { challenge: "challenge", rp: { name: "Neural Labs", id: "example.org" }, user: { id: "user-id", name: user.email, displayName: user.displayName }, pubKeyCredParams: [], timeout: 300000 },
    });
    if (url === "/api/account/passkeys/registration/verify" && init?.method === "POST") {
      passkeys = [createdPasskey];
      return json({ passkey: createdPasskey }, 201);
    }
    if (url === "/api/account/openai/connect" && init?.method === "POST") {
      currentOpenAI = {
      ...currentOpenAI,
      state: "awaiting_user",
      paused: false,
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-EFGH",
      expiresAt: "2026-09-03T01:00:00.000Z",
      };
      return json(currentOpenAI, 202);
    }
    if (url === "/api/account/identities/local" && init?.method === "POST") return json({ provider: "local" }, 201);
    return json({ error: { message: "Unexpected request" } }, 500);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Settings personalization panel", () => {
  it("shows the active identity and available sign-in methods", async () => {
    render(<PersonalizationPanel user={user} providers={["local"]} csrfToken="csrf-token" fontScale={100} onFontScaleChange={vi.fn()} onLogout={vi.fn()} />);

    expect(screen.getAllByText("Example Developer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("developer@example.org").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Member").length).toBeGreaterThan(0);
    expect(await screen.findByRole("link", { name: "Link Microsoft" })).toHaveAttribute("href", "/auth/microsoft?intent=link");
    expect(screen.getByText("Email & password").closest("article")).toHaveTextContent("Linked");
  });

  it("links a local password with the session CSRF token", async () => {
    render(<PersonalizationPanel user={user} providers={["microsoft"]} csrfToken="csrf-token" fontScale={100} onFontScaleChange={vi.fn()} onLogout={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/Add a local password/), { target: { value: "a-secure-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Link local login" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/account/identities/local",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ password: "a-secure-password" }) }),
    ));
    const identityRequest = vi.mocked(fetch).mock.calls.find(([path]) => path === "/api/account/identities/local");
    expect(new Headers(identityRequest?.[1]?.headers).get("X-CSRF-Token")).toBe("csrf-token");
    expect(await screen.findByText("Local login is now linked to your account.")).toBeInTheDocument();
    expect(screen.getByText("Email & password").closest("article")).toHaveTextContent("Linked");
  });

  it("creates a passkey only for a Microsoft-linked account and sends CSRF on both steps", async () => {
    render(<PersonalizationPanel user={user} providers={["microsoft"]} csrfToken="csrf-token" fontScale={100} onFontScaleChange={vi.fn()} onLogout={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Create passkey" }));

    expect(await screen.findByText("My passkey is ready for Neural Labs sign-in.")).toBeInTheDocument();
    const passkeyList = screen.getByRole("list", { name: "Your passkeys" });
    expect(passkeyList).toHaveTextContent("Synced passkey");
    expect(passkeyList).toHaveTextContent(new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(createdPasskey.createdAt)));
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => input === "/api/account/passkeys")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add passkey" })).toBeInTheDocument();
    expect(startRegistration).toHaveBeenCalledOnce();
    for (const path of ["/api/account/passkeys/registration/options", "/api/account/passkeys/registration/verify"]) {
      const call = vi.mocked(fetch).mock.calls.find(([input]) => input === path);
      expect(new Headers(call?.[1]?.headers).get("X-CSRF-Token")).toBe("csrf-token");
    }
  });

  it("changes and resets the desktop-wide font size", () => {
    const onFontScaleChange = vi.fn();
    const view = render(<PersonalizationPanel user={user} providers={["local"]} csrfToken="csrf-token" fontScale={120} onFontScaleChange={onFontScaleChange} onLogout={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Reset font size to 100%" })).toHaveTextContent("120%");
    fireEvent.click(screen.getByRole("button", { name: "Increase font size" }));
    expect(onFontScaleChange).toHaveBeenCalledWith(130);
    fireEvent.click(screen.getByRole("button", { name: "Reset font size to 100%" }));
    expect(onFontScaleChange).toHaveBeenCalledWith(100);

    view.rerender(<PersonalizationPanel user={user} providers={["local"]} csrfToken="csrf-token" fontScale={150} onFontScaleChange={onFontScaleChange} onLogout={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Increase font size" })).toBeDisabled();
    view.rerender(<PersonalizationPanel user={user} providers={["local"]} csrfToken="csrf-token" fontScale={90} onFontScaleChange={onFontScaleChange} onLogout={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Decrease font size" })).toBeDisabled();
  });

  it("starts a personal ChatGPT device-code connection", async () => {
    render(<PersonalizationPanel user={user} providers={["local"]} csrfToken="csrf-token" fontScale={100} onFontScaleChange={vi.fn()} onLogout={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect ChatGPT" }));

    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open OpenAI sign-in/ })).toHaveAttribute("href", "https://auth.openai.com/codex/device");
    const request = vi.mocked(fetch).mock.calls.find(([path]) => path === "/api/account/openai/connect");
    expect(new Headers(request?.[1]?.headers).get("X-CSRF-Token")).toBe("csrf-token");
  });
});
