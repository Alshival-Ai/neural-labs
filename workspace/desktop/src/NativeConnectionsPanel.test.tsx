import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NativeConnectionsPanel } from "./NativeConnectionsPanel";
import { TerminalLaunchContext } from "./TerminalLaunchContext";
import { configureNativeActor, nativeSelection } from "./nativeApi";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it("connects OpenAI in its card, shows the device code, then selects a loaded model", async () => {
  configureNativeActor("fixture", "fixture-csrf");
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  let checks = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (input === "/api/runtime/connections") return Response.json({ connections: [
      { id: "personal", provider: "codex", scope: "personal", method: "subscription", enabled: true, generation: 1, label: "My OpenAI" },
    ] });
    if (input === "/api/runtime/defaults") return Response.json({ revision: init?.method === "PUT" ? 1 : 0 });
    expect(input).toBe("/api/runtime/request");
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("fixture-csrf");
    const request = JSON.parse(String(init?.body));
    if (request.operation === "account.status") {
      checks++;
      return Response.json(checks >= 3 ? { ready: true, pending: false } : { ready: false, pending: true, signIn: { verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-EFGH" } });
    }
    if (request.operation === "account.login") return Response.json({ terminalId: "private-terminal" });
    expect(request.operation).toBe("models.list");
    return Response.json({ defaultModel: "gpt-fixture", models: [{ id: "gpt-fixture", name: "GPT fixture", available: true }] });
  });
  render(<NativeConnectionsPanel csrfToken="fixture-csrf" />);
  await screen.findByRole("button", { name: "Connect OpenAI" });
  fireEvent.click(screen.getByRole("button", { name: "Connect OpenAI" }));
  expect(open).toHaveBeenCalledWith("https://auth.openai.com/codex/device", "_blank", "noopener,noreferrer");
  await screen.findByText("ABCD-EFGH");
  await waitFor(() => expect(checks).toBeGreaterThanOrEqual(3), { timeout: 4000 });
  await screen.findByRole("option", { name: "GPT fixture" });
  await waitFor(() => expect(nativeSelection()).toEqual({ connection: "personal", model: "gpt-fixture" }));
});
it("loads models on demand from the selected account and never silently selects shared AI", async () => {
  configureNativeActor("fixture", "fixture-csrf");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (input === "/api/runtime/connections") return Response.json({ connections: [
      { id: "shared", provider: "claude", scope: "shared", method: "subscription", enabled: true, generation: 1, label: "Shared Claude" },
    ] });
    if (input === "/api/runtime/defaults") return Response.json({ revision: init?.method === "PUT" ? 1 : 0 });
    expect(JSON.parse(String(init?.body))).toMatchObject({ operation: "models.list", selection: { connection: "shared" } });
    return Response.json({ models: [{ id: "claude-exact", name: "Claude fixture", available: true }] });
  });
  render(<NativeConnectionsPanel csrfToken="fixture-csrf" />);
  await screen.findByRole("option", { name: "Shared Claude · shared" });
  fireEvent.change(screen.getByLabelText("Connection"), { target: { value: "shared" } });
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Load models" }));
  await screen.findByRole("option", { name: "Claude fixture" });
  expect(nativeSelection()).toBeUndefined();
  fireEvent.change(screen.getByLabelText("Model"), { target: { value: "claude-exact" } });
  fireEvent.click(screen.getByRole("button", { name: "Use for my chats" }));
  await waitFor(() => expect(nativeSelection()).toEqual({ connection: "shared", model: "claude-exact" }));
});

it("requires an administrator to save an explicit native Team connection and model", async () => {
  configureNativeActor("admin", "fixture-csrf");
  const requests: Array<{ url: string; body?: unknown }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (input === "/api/runtime/connections") return Response.json({ connections: [
      { id: "team", provider: "claude", scope: "team", method: "subscription", enabled: true, generation: 3, label: "Team Claude" },
    ] });
    if (input === "/api/admin/runtime/team-defaults") return Response.json({ revision: init?.method === "PUT" ? 1 : 0 });
    return Response.json({ models: [{ id: "claude-team", name: "Claude Team", available: true }] });
  });
  render(<NativeConnectionsPanel csrfToken="fixture-csrf" administrator />);
  await screen.findByRole("option", { name: "Team Claude · team" });
  fireEvent.change(screen.getByLabelText("Connection"), { target: { value: "team" } });
  fireEvent.click(screen.getByRole("button", { name: "Load models" }));
  await screen.findByRole("option", { name: "Claude Team" });
  fireEvent.click(screen.getByRole("button", { name: "Use for Team Chat" }));
  await screen.findByText("Team Claude selected for Team Chat.");
  expect(requests.find(row => row.url === "/api/admin/runtime/team-defaults" && row.body)).toEqual({
    url: "/api/admin/runtime/team-defaults", body: { connection: "team", model: "claude-team", generation: 3, revision: 0 },
  });
  expect(nativeSelection()).toBeUndefined();
});

it("offers a new OpenAI sign-in when the device attempt ends", async () => {
  configureNativeActor("fixture", "fixture-csrf");
  vi.spyOn(window, "open").mockImplementation(() => null);
  let checks = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (input === "/api/runtime/connections") return Response.json({ connections: [
      { id: "personal", provider: "codex", scope: "personal", method: "subscription", enabled: true, generation: 1, label: "My OpenAI" },
    ] });
    const operation = JSON.parse(String(init?.body)).operation;
    if (operation === "account.login") return Response.json({ terminalId: "private-terminal" });
    checks++;
    return Response.json({ ready: false, pending: checks < 3,
      ...(checks < 3 ? { signIn: { verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-EFGH" } } : {}) });
  });
  render(<NativeConnectionsPanel csrfToken="fixture-csrf" />);
  fireEvent.click(await screen.findByRole("button", { name: "Connect OpenAI" }));
  await screen.findByText("ABCD-EFGH");
  await screen.findByText("OpenAI sign-in ended. Start a new sign-in to try again.", {}, { timeout: 4000 });
  expect(screen.getByRole("button", { name: "Connect OpenAI" })).toBeEnabled();
});
