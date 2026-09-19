import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClaudeProviderConnection } from "./ClaudeProviderConnection";
const native = vi.hoisted(() => ({ open: vi.fn(), write: vi.fn(), dispose: vi.fn(), focus: vi.fn(), paste: vi.fn(), input: undefined as ((data: string) => void) | undefined }));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  options = { disableStdin: true }; cols = 90; rows = 20;
  open = native.open; write = native.write; dispose = native.dispose; focus = native.focus;
  loadAddon() {};
  onData(callback: (data: string) => void) { native.input = callback; return { dispose: vi.fn() }; }
  paste(text: string) { native.paste(text); native.input?.(text); }
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close() { this.readyState = 3; this.onclose?.(); }
  message(value: object) { this.onmessage?.({ data: JSON.stringify(value) }); }
  constructor(readonly url: URL, readonly protocols: string[]) {
    Socket.instances.push(this);
    queueMicrotask(() => this.message({ type: "ready", data: "Native prompt", verificationUrl: "https://claude.ai/oauth/authorize?state=example" }));
  }
}
beforeEach(() => { Socket.instances = []; vi.stubGlobal("WebSocket", Socket); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const disconnected = { provider: "anthropic", authMethod: "subscription", agentId: "nl-user", authenticated: false, modelReady: false, paused: true, state: "disconnected" };
function signInFetch() {
  let loggingIn = false;
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith("/connect")) loggingIn = true;
    if (url.endsWith("/cancel")) loggingIn = false;
    const result = url.includes("/terminal-ticket") ? { ticket: "example-ticket", path: "/workspace/api/claude-login/socket", protocol: "neural-claude-login.v1" }
      : { ...disconnected, ...(loggingIn ? { state: "awaiting_user", ...(url.endsWith("/connect") ? { attemptId: "123" } : {}) } : {}) };
    return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetch); return fetch;
}
async function connect() {
  render(<ClaudeProviderConnection csrfToken="csrf" />);
  fireEvent.click(await screen.findByRole("button", { name: "Connect Claude" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Paste into terminal" })).toBeEnabled());
  return Socket.instances.at(-1)!;
}
it("streams the native prompt and input over a ticketed WebSocket and cancels through the authenticated endpoint", async () => {
  const fetch = signInFetch();
  const socket = await connect();
  expect(native.write).toHaveBeenCalledWith("Native prompt");
  expect(socket.url.pathname).toBe("/workspace/api/claude-login/socket");
  expect(socket.url.search).toBe("");
  expect(socket.protocols).toEqual(["neural-claude-login.v1", "ticket.example-ticket"]);
  expect(new Headers(fetch.mock.calls.find(([url]) => url.endsWith("/terminal-ticket"))?.[1]?.headers).get("X-CSRF-Token")).toBe("csrf");
  native.input?.("example-code\r");
  expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: "example-code\r" }));
  expect(fetch.mock.calls.some(([url, init]) => url.endsWith("/terminal") || String(init?.body).includes("example-code"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Cancel sign-in" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Native Claude sign-in terminal" })).toBeNull());
});
it("pastes clipboard content into xterm and offers ordinary code entry when clipboard access is denied", async () => {
  signInFetch();
  const socket = await connect();
  const readText = vi.fn().mockResolvedValueOnce("clipboard-code").mockRejectedValueOnce(new Error("Denied"));
  vi.stubGlobal("navigator", { clipboard: { readText } });
  fireEvent.click(screen.getByRole("button", { name: "Paste into terminal" }));
  await waitFor(() => expect(native.paste).toHaveBeenCalledWith("clipboard-code"));
  expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: "clipboard-code" }));
  fireEvent.click(screen.getByRole("button", { name: "Paste into terminal" }));
  await screen.findByText(/Clipboard access is unavailable/);
  fireEvent.change(screen.getByLabelText("Sign-in code"), { target: { value: "example-code#state" } });
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: "example-code#state\r" }));
  expect(screen.getByLabelText("Sign-in code")).toHaveValue("");
});
it("reconnects with a new ticket without replaying a previously submitted code", async () => {
  const fetch = signInFetch();
  const socket = await connect();
  fireEvent.change(screen.getByLabelText("Sign-in code"), { target: { value: "example-code" } });
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  socket.close();
  await screen.findByText(/The sign-in terminal disconnected/);
  expect(screen.getByRole("button", { name: "Send code" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Reconnect sign-in terminal" }));
  await waitFor(() => expect(Socket.instances).toHaveLength(2));
  await waitFor(() => expect(screen.getByRole("button", { name: "Paste into terminal" })).toBeEnabled());
  expect(Socket.instances[1].send).not.toHaveBeenCalled();
  expect(fetch.mock.calls.filter(([url]) => url.endsWith("/terminal-ticket"))).toHaveLength(2);
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
