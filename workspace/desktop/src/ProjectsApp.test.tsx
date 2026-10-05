import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("refreshes from environment invalidations without discarding an open editor", async () => {
  let title = "Original title";
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("fetch", vi.fn(async (path: string) => ({ ok: true, status: 200, json: async () => path.endsWith("/members") ? { members: [] } : path.endsWith("/statuses") ? { statuses: [{ id: "todo", name: "To do", category: "todo", legacy_state: "todo", retired: false, position: 0 }], can_manage: false } : { items: [{ id: "fixture", kind: "task", revision: title === "Original title" ? 1 : 2, data: { title, body: "", state: "todo", status_id: "todo", priority: "normal", archived: false } }], next: null } })));
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
it("switches project tasks and workflows with the selected board", async () => {
  vi.stubGlobal("WebSocket", Socket);
  const data = (title: string, board_id?: string, status_id?: string) => ({ title, body: "", board_id, status_id, state: "todo", priority: "normal", archived: false });
  const boards = [{ id: "board-a", kind: "board", revision: 1, data: data("Board A") }, { id: "board-b", kind: "board", revision: 1, data: data("Board B") }];
  const items = [{ id: "task-a", kind: "task", revision: 1, data: data("First board task", "board-a", "status-a") }, { id: "task-b", kind: "task", revision: 1, data: data("Second board task", "board-b", "status-b") }];
  vi.stubGlobal("fetch", vi.fn(async (path: string) => ({ ok: true, status: 200, json: async () =>
    path.endsWith("/members") ? { members: [] } : path.endsWith("/boards") ? { boards } : path.endsWith("/edges") ? { edges: [] } :
    path.endsWith("/statuses") ? { can_manage: false, statuses: [
      { id: "status-a", board_id: "board-a", name: "A workflow", is_default: true, retired: false },
      { id: "status-b", board_id: "board-b", name: "B workflow", is_default: true, retired: false },
    ] } : { items, next: null } })));
  render(<ProjectsApp />);
  expect(await screen.findByText("First board task")).toBeInTheDocument();
  expect(screen.queryByText("Second board task")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Project board"), { target: { value: "board-b" } });
  expect(await screen.findByText("Second board task")).toBeInTheDocument();
  expect(screen.queryByText("First board task")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "B workflow" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "A workflow" })).not.toBeInTheDocument();
});

it("keeps each person's note arrangement local without patching shared notes", async () => {
  localStorage.clear();
  vi.stubGlobal("WebSocket", Socket);
  const request = vi.fn(async (path: string, _options?: RequestInit) => ({ ok: true, status: 200, json: async () =>
    path.endsWith("/members") ? { members: [] } : path.endsWith("/boards") ? { boards: [] } : path.endsWith("/edges") ? { edges: [] } :
    path.endsWith("/statuses") ? { can_manage: false, statuses: [] } : { items: [{ id: "note-a", kind: "note", revision: 3,
      data: { title: "Personal placement", body: "Shared text", position: { x: 999, y: 999 }, parent_id: null, archived: false } }], next: null } }));
  vi.stubGlobal("fetch", request);
  const view = render(<ProjectsApp storageNamespace="person-one" />);
  fireEvent.click(await screen.findByRole("button", { name: "Notes" }));
  const note = (await screen.findByText("Personal placement")).closest("button")!;
  expect(note.style.left).toBe("12px");
  fireEvent.keyDown(note, { key: "ArrowRight", altKey: true });
  expect(note.style.left).toBe("32px");
  expect(request.mock.calls.every(call => !(call[1] as RequestInit | undefined)?.method || (call[1] as RequestInit).method === "GET")).toBe(true);
  view.rerender(<ProjectsApp storageNamespace="person-two" />);
  await waitFor(() => expect(note.style.left).toBe("12px"));
  view.rerender(<ProjectsApp storageNamespace="person-one" />);
  await waitFor(() => expect(note.style.left).toBe("32px"));
});
