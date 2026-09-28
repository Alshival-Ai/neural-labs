import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectsApp } from "./ProjectsApp";

class Socket {
  static latest: Socket;
  onopen?: () => void;
  onmessage?: () => void;
  onclose?: (event: { code: number }) => void;
  constructor() { Socket.latest = this; }
  close() {}
}
afterEach(() => vi.unstubAllGlobals());
it("refreshes from environment invalidations without discarding an open editor", async () => {
  let title = "Original title";
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("fetch", vi.fn(async (path: string) => ({ ok: true, status: 200, json: async () => path.endsWith("/members") ? { members: [] } : { items: [{ id: "fixture", kind: "task", revision: title === "Original title" ? 1 : 2, data: { title, body: "", state: "todo", priority: "normal", archived: false } }], next: null } })));
  render(<ProjectsApp />);
  fireEvent.click(await screen.findByText("Original title"));
  expect(screen.getByLabelText("Title")).toHaveValue("Original title");
  title = "Someone else's edit";
  await act(async () => { Socket.latest.onmessage?.(); });
  await waitFor(() => expect(screen.getByText("Someone else's edit")).toBeInTheDocument());
  expect(screen.getByLabelText("Title")).toHaveValue("Original title");
  fireEvent.click(screen.getByText("Load current version"));
  expect(screen.getByLabelText("Title")).toHaveValue("Someone else's edit");
});
