import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ModelProviderPanel } from "./ModelProviderPanel";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function setup(connected = false, failDisconnect = false, staleRefresh = false) {
  let authenticated = connected;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/disconnect")) {
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-csrf-token")).toBe("test-csrf");
      if (failDisconnect) return Response.json({ error: { message: "Try again later." } }, { status: 409 });
      authenticated = false;
    }
    if (url.includes("/openai")) return Response.json({ state: authenticated ? "connected" : "disconnected", authenticated, modelReady: authenticated, paused: !authenticated });
    if (url.endsWith("/catalog")) return Response.json({ models: [{ id: "openai/test", name: "Test model", provider: "openai", available: true, efforts: [{ id: "high", label: "High" }] }, ...(init?.method === "POST" ? [{ id: "openai/gpt-6-astra", name: "GPT-6 Astra", provider: "openai", available: true, efforts: [{ id: "high", label: "High" }] }] : [])], runtime: { name: "Codex", version: "0.152.0" }, fetchedAt: "2026-09-05T00:00:00Z", stale: staleRefresh && init?.method === "POST" });
    if (url.endsWith("/defaults")) return Response.json({ policy: { provider: "openai", mode: "latest", model: "", effort: "" }, revision: 0, resolved: { model: "openai/test" }, pending: false });
    throw new Error(`Unexpected request ${url}`);
  });
  render(<ModelProviderPanel csrfToken="test-csrf" />);
  return fetch;
}

it("shows provider cards without defaults before connection, and opens provider details", async () => {
  const fetch = setup();
  await screen.findByText("Not connected");
  expect(screen.queryByRole("heading", { name: "Agent defaults" })).toBeNull();
  expect(fetch.mock.calls.some(([url]) => String(url).includes("model-providers"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Set up OpenAI" }));
  expect(await screen.findByRole("heading", { name: "Your ChatGPT account" })).toBeTruthy();
  expect(document.activeElement?.textContent).toBe("OpenAI");
  fireEvent.click(screen.getByRole("button", { name: "Back to providers" }));
  fireEvent.click(screen.getByRole("button", { name: "Configure Claude" }));
  expect(screen.getByRole("heading", { name: "Claude is coming soon" })).toBeTruthy();
});

it("shows connected defaults above cards and requires confirmation to disconnect", async () => {
  const fetch = setup(true);
  await screen.findByRole("combobox", { name: "Default provider" });
  expect(screen.getByRole("combobox", { name: "Model" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/disconnect"))).toBe(false);
  expect(document.activeElement?.textContent).toBe("Disconnect OpenAI?");
  fireEvent.click(screen.getByRole("button", { name: "Keep connected" }));
  expect(screen.queryByRole("button", { name: "Confirm disconnect" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));
  await screen.findByText("OpenAI disconnected. Your chats and saved preferences are unchanged.");
  expect(screen.queryByRole("heading", { name: "Agent defaults" })).toBeNull();
  expect(screen.getByRole("button", { name: "Set up OpenAI" })).toBeTruthy();
});

it("retains the connection and actionable error when disconnect fails", async () => {
  setup(true, true);
  await screen.findByText("Connected");
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));
  await screen.findByText("Try again later.");
  await waitFor(() => expect(screen.getByRole("button", { name: "Confirm disconnect" }).hasAttribute("disabled")).toBe(false));
  expect(screen.getByRole("heading", { name: "Agent defaults" })).toBeTruthy();
});

it("reports unknown status without pretending the provider is disconnected", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: { message: "Unavailable" } }, { status: 503 }));
  render(<ModelProviderPanel csrfToken="test-csrf" />);
  await screen.findByText("Status unavailable");
  expect(screen.getByRole("button", { name: "Set up OpenAI" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Retry connection status" })).toBeTruthy();
});

it("refreshes the owned catalog without saving or discarding draft model selections", async () => {
  const fetch = setup(true);
  const model = await screen.findByRole("combobox", { name: "Model" });
  fireEvent.change(model, { target: { value: "openai/test" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Reasoning" }), { target: { value: "high" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh connection" }));
  await screen.findByText("Connection and models refreshed. Your defaults are unchanged.");
  expect(await screen.findByRole("option", { name: "GPT-6 Astra · openai" })).toBeTruthy();
  expect((model as HTMLSelectElement).value).toBe("openai/test");
  expect((screen.getByRole("combobox", { name: "Reasoning" }) as HTMLSelectElement).value).toBe("high");
  const writes = fetch.mock.calls.filter(([, init]) => init?.method && init.method !== "GET");
  expect(writes).toHaveLength(1);
  expect(writes[0]?.[0]).toBe("/api/account/model-providers/catalog");
  expect(new Headers(writes[0]?.[1]?.headers).get("x-csrf-token")).toBe("test-csrf");
  expect(screen.getByText(/Codex 0.152.0/)).toBeTruthy();
});

it("does not report cached fallback data as a successful refresh", async () => {
  setup(true, false, true);
  await screen.findByRole("combobox", { name: "Model" });
  fireEvent.click(screen.getByRole("button", { name: "Refresh connection" }));
  await screen.findAllByText("Refresh failed. Showing cached models.");
  expect(screen.queryByText("Connection and models refreshed. Your defaults are unchanged.")).toBeNull();
});
