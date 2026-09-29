import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NativeConnectionsPanel } from "./NativeConnectionsPanel";
import { TerminalLaunchContext } from "./TerminalLaunchContext";
import { configureNativeActor, nativeSelection } from "./nativeApi";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it("opens native login for the explicitly chosen owner in a private Terminal", async () => {
  configureNativeActor("fixture", "fixture-csrf");
  const terminal = vi.fn(async () => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (input === "/api/runtime/connections") return Response.json({ connections: [
      { id: "personal", provider: "codex", scope: "personal", method: "subscription", enabled: true, generation: 1, label: "My Codex" },
      { id: "background", provider: "claude", scope: "background", method: "subscription", enabled: true, generation: 2, label: "Scheduled Claude" },
    ] });
    expect(input).toBe("/api/runtime/request");
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("fixture-csrf");
    expect(JSON.parse(String(init?.body))).toMatchObject({ operation: "account.login", selection: { connection: "background" } });
    return Response.json({ terminalId: "private-terminal" });
  });
  render(<TerminalLaunchContext.Provider value={terminal}><NativeConnectionsPanel csrfToken="fixture-csrf" administrator /></TerminalLaunchContext.Provider>);
  await screen.findByRole("option", { name: "Scheduled Claude · background" });
  fireEvent.change(screen.getByLabelText("Connection"), { target: { value: "background" } });
  expect(screen.getByRole("button", { name: "Use for my chats" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Sign in in Terminal" }));
  await waitFor(() => expect(terminal).toHaveBeenCalledWith("private-terminal"));
  expect(nativeSelection()).toBeUndefined();
});
it("loads models on demand from the selected account and never silently selects shared AI", async () => {
  configureNativeActor("fixture", "fixture-csrf");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (input === "/api/runtime/connections") return Response.json({ connections: [
      { id: "shared", provider: "claude", scope: "shared", method: "subscription", enabled: true, generation: 1, label: "Shared Claude" },
    ] });
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
  expect(nativeSelection()).toEqual({ connection: "shared", model: "claude-exact" });
});
