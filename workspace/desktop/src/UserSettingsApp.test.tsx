import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PersonalizationPanel } from "./UserSettingsApp";

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

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/auth/providers") {
      return json({ local: { enabled: true }, microsoft: { available: true, enabled: true } });
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
});
