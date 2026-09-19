import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ClaudeProviderConnection } from "./ClaudeProviderConnection";
import { TerminalLaunchContext } from "./TerminalLaunchContext";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const disconnected = { provider: "anthropic", authMethod: "subscription", agentId: "nl-user", authenticated: false, modelReady: false, paused: true, state: "disconnected" };
it("opens and reopens the actual Terminal session without rendering a Settings terminal", async () => {
  const open = vi.fn(async () => {});
  let loggingIn = false;
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith("/connect")) loggingIn = true;
    if (url.endsWith("/cancel")) loggingIn = false;
    return new Response(JSON.stringify({ ...disconnected, ...(loggingIn ? { state: "awaiting_user", attemptId: "attempt", terminalId: "terminal" } : {}) }));
  });
  vi.stubGlobal("fetch", fetch);
  render(<TerminalLaunchContext.Provider value={open}><ClaudeProviderConnection csrfToken="csrf" /></TerminalLaunchContext.Provider>);
  fireEvent.click(await screen.findByRole("button", { name: "Connect Claude" }));
  await waitFor(() => expect(open).toHaveBeenCalledWith("terminal"));
  expect(screen.queryByRole("region", { name: "Native Claude sign-in terminal" })).toBeNull();
  expect(screen.queryByLabelText("Sign-in code")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open sign-in in Terminal" }));
  await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Cancel sign-in" }));
  await screen.findByRole("button", { name: "Connect Claude" });
  expect(fetch.mock.calls.some(([url]) => url.includes("terminal-ticket"))).toBe(false);
});
it("retains a reopen action when the desktop cannot open a window", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...disconnected, state: "awaiting_user", attemptId: "attempt", terminalId: "terminal" }))));
  const open = vi.fn(async () => { throw new Error("Close a window first"); });
  render(<TerminalLaunchContext.Provider value={open}><ClaudeProviderConnection csrfToken="csrf" /></TerminalLaunchContext.Provider>);
  fireEvent.click(await screen.findByRole("button", { name: "Continue Claude sign-in" }));
  await screen.findByText("Close a window first");
  expect(screen.getByRole("button", { name: "Open sign-in in Terminal" })).toBeEnabled();
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
