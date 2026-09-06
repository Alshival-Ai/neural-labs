import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginCardsPanel } from "./PluginCardsPanel";
import type { ApiProviderPlugin, PluginCatalog } from "./settingsApi";
const provider: ApiProviderPlugin = { id: "klipy", type: "api-provider", name: "KLIPY", description: "GIFs for Neura", scope: "global", ownership: "workspace", editable: true, configured: false, ready: false, source: null, applied: true, revision: 0, appliedRevision: 0, deploymentOverride: false, state: "disconnected", capabilities: ["GIF search"], check: null };
function setup(editable = true) {
  let current = { ...provider, editable };
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input) === "/api/plugins") return Response.json({ plugins: [current] } satisfies PluginCatalog);
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      current = body.action === "inherit" ? { ...current, revision: 3, source: "environment", deploymentOverride: false, state: "configured" }
        : { ...current, revision: 1, configured: true, source: "settings", deploymentOverride: true, state: "configured" };
      return Response.json(current);
    }
    if (init?.method === "DELETE") { current = { ...current, revision: 2, configured: false, source: null, state: "disconnected" }; return Response.json(current); }
    if (String(input).endsWith("/check")) { current = { ...current, state: "check-failed", check: { revision: 1, capabilities: [{ name: "GIF search", ok: false, message: "Provider unavailable. Try again later." }] } }; return Response.json(current); }
    throw new Error("Unexpected request");
  });
  render(<PluginCardsPanel administrator={editable} csrfToken="csrf-placeholder" renderSystem={() => null} />);
  return fetch;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("plugin setup cards", () => {
  it("saves a replacement key, clears the input, displays a check failure, and preserves the scope filter", async () => {
    const fetch = setup();
    fireEvent.click(await screen.findByRole("tab", { name: "Global" }));
    fireEvent.click(screen.getByRole("button", { name: "Set up KLIPY" }));
    const input = screen.getByLabelText("API key");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.change(input, { target: { value: "placeholder-provider-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(input).toHaveValue(""));
    const saved = fetch.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(new Headers(saved?.[1]?.headers).get("X-CSRF-Token")).toBe("csrf-placeholder");
    expect(JSON.parse(String(saved?.[1]?.body))).toEqual({ action: "save", apiKey: "placeholder-provider-key" });
    fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
    expect(await screen.findByText("Provider unavailable. Try again later.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All plugins" }));
    expect(screen.getByRole("tab", { name: "Global" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Manage KLIPY" })).toHaveTextContent("Connection needs attention");
  });
  it("requires confirmation to disconnect and explicitly restores deployment configuration", async () => {
    const fetch = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Set up KLIPY" }));
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "placeholder-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await screen.findByRole("button", { name: "Disconnect KLIPY" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect KLIPY" }));
    expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect KLIPY" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Disconnect KLIPY" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Use deployment configuration" }));
    expect(await screen.findByText("Using deployment configuration.")).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(3);
  });
  it("allows members to inspect a service without credential controls or admin requests", async () => {
    const fetch = setup(false);
    fireEvent.click(await screen.findByRole("button", { name: "View details for KLIPY" }));
    expect(screen.getByText(/Only a workspace administrator/)).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([url]) => String(url).startsWith("/api/admin/"))).toBe(false);
  });
  it("retries catalog failures and shows a private empty state", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue(Response.json({ plugins: [] }));
    render(<PluginCardsPanel administrator={false} csrfToken="csrf" renderSystem={() => null} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry plugins" }));
    expect(await screen.findByText("No private plugins yet.")).toBeInTheDocument();
  });
});
