import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ClaudeProviderConnection } from "./ClaudeProviderConnection";
const native = vi.hoisted(() => ({ open: vi.fn(), write: vi.fn(), dispose: vi.fn(), onData: vi.fn(() => ({ dispose: vi.fn() })), focus: vi.fn() }));
vi.mock("@xterm/xterm", () => ({ Terminal: class { open = native.open; write = native.write; dispose = native.dispose; onData = native.onData; focus = native.focus; } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const disconnected = { provider: "anthropic", authMethod: "subscription", agentId: "nl-user", authenticated: false, modelReady: false, paused: true, state: "disconnected" };
it("launches the native prompt from Settings and cancels through the authenticated endpoint", async () => {
  let loggingIn = false;
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => { if (url.endsWith("/connect")) loggingIn = true; if (url.endsWith("/cancel")) loggingIn = false; return new Response(JSON.stringify(url.includes("/terminal") ? { output: "Open the native login URL", cursor: 25 } : url.includes("/connect?") || url.endsWith("/connect") ? { ...disconnected, state: "awaiting_user", attemptId: "123" } : loggingIn ? { ...disconnected, state: "awaiting_user" } : disconnected), { headers: { "content-type": "application/json" } }); });
  vi.stubGlobal("fetch", fetch);
  render(<ClaudeProviderConnection csrfToken="csrf" />);
  fireEvent.click(await screen.findByRole("button", { name: "Connect Claude" }));
  await screen.findByRole("region", { name: "Native Claude sign-in terminal" });
  expect(native.open).toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledWith("/api/account/model-providers/anthropic/connection/connect", expect.objectContaining({ method: "POST", headers: expect.any(Headers) }));
  expect(new Headers(fetch.mock.calls.find(([url]) => url.endsWith("/connect"))?.[1]?.headers).get("X-CSRF-Token")).toBe("csrf");
  fireEvent.click(screen.getByRole("button", { name: "Cancel sign-in" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Native Claude sign-in terminal" })).toBeNull());
});
it("workspace API keys have explicit billing copy and the selected workload", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(disconnected), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  render(<ClaudeProviderConnection csrfToken="csrf" workload="team" />);
  fireEvent.click(await screen.findByRole("button", { name: "Use a workspace API key" }));
  expect(screen.getByText(/API usage is billed separately/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Anthropic API key"), { target: { value: "placeholder-test-key" } });
  fireEvent.click(screen.getByRole("button", { name: "Save and use API key" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/admin/workspace/model-providers/anthropic/connection/api-key?workload=team", expect.objectContaining({ body: JSON.stringify({ key: "placeholder-test-key" }) })));
});
it("personal accounts do not present the workspace API-key form", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(disconnected))));
  render(<ClaudeProviderConnection csrfToken="csrf" />);
  await screen.findByText("Not connected");
  expect(screen.queryByRole("button", { name: "Use a workspace API key" })).toBeNull();
});
