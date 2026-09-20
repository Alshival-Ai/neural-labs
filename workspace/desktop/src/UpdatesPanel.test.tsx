import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdatesPanel, nextWindow, type UpdateStatus } from "./UpdatesPanel";
const initial: UpdateStatus = { revision: 1,
  policy: { openclawAutomatic: false, codexAutomatic: true, days: [0], start: "03:00", end: "05:00", timezone: "America/Chicago" },
  maintenance: false, installed: { openclawVersion: "2026.9.5", codexVersion: "0.155.1" }, available: null, codex: null,
  worker: { connected: false, lastSeen: null, lastCheck: null, error: null }, jobs: [] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("admin update settings", () => {
  it("shows offline state and saves explicit policy with its revision and CSRF token", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => init?.method === "PUT" ? Response.json({ revision: 2 }) : Response.json(initial));
    vi.stubGlobal("fetch", fetcher);
    render(<UpdatesPanel csrfToken="synthetic-csrf" />);
    expect(await screen.findByText("Offline or not installed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check now" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Automatically install reviewed OpenClaw releases" }));
    fireEvent.click(screen.getByRole("button", { name: "Save update settings" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const init = fetcher.mock.calls.find(([, init]) => init?.method === "PUT")![1]!;
    expect(JSON.parse(String(init.body))).toEqual({ revision: 1, policy: { ...initial.policy, openclawAutomatic: true } });
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("synthetic-csrf");
  });
  it("keeps unsaved edits after a revision conflict", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => init?.method === "PUT"
      ? Response.json({ error: { message: "Settings changed in another window." } }, { status: 409 }) : Response.json(initial)));
    render(<UpdatesPanel csrfToken="test" />);
    const checkbox = await screen.findByRole("checkbox", { name: "Automatically install reviewed OpenClaw releases" });
    fireEvent.click(checkbox); fireEvent.click(screen.getByRole("button", { name: "Save update settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Settings changed"); expect(checkbox).toBeChecked();
  });
  it("locates the saved local window across daylight-saving changes", () => {
    expect(nextWindow(initial.policy, new Date("2026-03-08T07:59:00Z"))?.toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(nextWindow(initial.policy, new Date("2026-11-01T08:59:00Z"))?.toISOString()).toBe("2026-11-01T09:00:00.000Z");
  });
});
