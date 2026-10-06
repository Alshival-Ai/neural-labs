import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectsApp } from "./ProjectsApp";

class Socket {
  static latest: Socket;
  onopen?: () => void;
  onmessage?: () => void;
  onclose?: (event: { code: number }) => void;
  constructor() {
    Socket.latest = this;
  }
  close() {}
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("refreshes from environment invalidations without discarding an open editor", async () => {
  let title = "Original title";
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        path.endsWith("/members")
          ? { members: [] }
          : path.endsWith("/statuses")
            ? {
                statuses: [
                  {
                    id: "todo",
                    name: "To do",
                    category: "todo",
                    legacy_state: "todo",
                    retired: false,
                    position: 0,
                  },
                ],
                can_manage: false,
              }
            : {
                items: [
                  {
                    id: "fixture",
                    kind: "task",
                    revision: title === "Original title" ? 1 : 2,
                    data: {
                      title,
                      body: "",
                      state: "todo",
                      status_id: "todo",
                      priority: "normal",
                      archived: false,
                    },
                  },
                ],
                next: null,
              },
    })),
  );
  render(<ProjectsApp />);
  fireEvent.click(await screen.findByText("Original title"));
  expect(screen.getByLabelText("Title")).toHaveValue("Original title");
  title = "Someone else's edit";
  await act(async () => {
    Socket.latest.onmessage?.();
  });
  await waitFor(() =>
    expect(screen.getByText("Someone else's edit")).toBeInTheDocument(),
  );
  expect(screen.getByLabelText("Title")).toHaveValue("Original title");
  fireEvent.click(screen.getByText("Load current version"));
  expect(screen.getByLabelText("Title")).toHaveValue("Someone else's edit");
});
it("switches project tasks and workflows with the selected board", async () => {
  vi.stubGlobal("WebSocket", Socket);
  const data = (title: string, board_id?: string, status_id?: string) => ({
    title,
    body: "",
    board_id,
    status_id,
    state: "todo",
    priority: "normal",
    archived: false,
  });
  const boards = [
    { id: "board-a", kind: "board", revision: 1, data: data("Board A") },
    { id: "board-b", kind: "board", revision: 1, data: data("Board B") },
  ];
  const items = [
    {
      id: "task-a",
      kind: "task",
      revision: 1,
      data: data("First board task", "board-a", "status-a"),
    },
    {
      id: "task-b",
      kind: "task",
      revision: 1,
      data: data("Second board task", "board-b", "status-b"),
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        path.endsWith("/members")
          ? { members: [] }
          : path.endsWith("/boards")
            ? { boards }
            : path.endsWith("/edges")
              ? { edges: [] }
              : path.endsWith("/statuses")
                ? {
                    can_manage: false,
                    statuses: [
                      {
                        id: "status-a",
                        board_id: "board-a",
                        name: "A workflow",
                        is_default: true,
                        retired: false,
                      },
                      {
                        id: "status-b",
                        board_id: "board-b",
                        name: "B workflow",
                        is_default: true,
                        retired: false,
                      },
                    ],
                  }
                : { items, next: null },
    })),
  );
  render(<ProjectsApp />);
  expect(await screen.findByText("First board task")).toBeInTheDocument();
  expect(screen.queryByText("Second board task")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Project board"), {
    target: { value: "board-b" },
  });
  expect(await screen.findByText("Second board task")).toBeInTheDocument();
  expect(screen.queryByText("First board task")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "B workflow" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "A workflow" }),
  ).not.toBeInTheDocument();
});

it("keeps each person's note arrangement local without patching shared notes", async () => {
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.stubGlobal("WebSocket", Socket);
  const request = vi.fn(async (path: string, _options?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () =>
      path.endsWith("/members")
        ? { members: [] }
        : path.endsWith("/boards")
          ? { boards: [] }
          : path.endsWith("/edges")
            ? { edges: [] }
            : path.endsWith("/statuses")
              ? { can_manage: false, statuses: [] }
              : {
                  items: [
                    {
                      id: "note-a",
                      kind: "note",
                      revision: 3,
                      data: {
                        title: "Personal placement",
                        body: "Shared text",
                        position: { x: 999, y: 999 },
                        parent_id: null,
                        archived: false,
                      },
                    },
                  ],
                  next: null,
                },
  }));
  vi.stubGlobal("fetch", request);
  const view = render(<ProjectsApp storageNamespace="person-one" />);
  const handle = await screen.findByRole("button", {
    name: "Move note: Personal placement",
  });
  const note = handle.closest("article")!;
  expect(note.style.left).toBe("");
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(note.style.left).toBe("10px");
  expect(
    request.mock.calls.every(
      (call) =>
        !(call[1] as RequestInit | undefined)?.method ||
        (call[1] as RequestInit).method === "GET",
    ),
  ).toBe(true);
  view.rerender(<ProjectsApp storageNamespace="person-two" />);
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Move note: Personal placement" })
        .closest("article")!.style.left,
    ).toBe(""),
  );
  view.rerender(<ProjectsApp storageNamespace="person-one" />);
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Move note: Personal placement" })
        .closest("article")!.style.left,
    ).toBe("10px"),
  );
});

function projectFixture() {
  const base = {
    body: "",
    state: "todo",
    status_id: "todo",
    priority: "normal",
    archived: false,
    deleted: false,
  };
  let items = [
    {
      id: "task",
      kind: "task",
      revision: 3,
      author_id: "me",
      data: { ...base, title: "Plan the release" },
    },
    {
      id: "note",
      kind: "note",
      revision: 2,
      author_id: "me",
      data: {
        ...base,
        title: "Launch ideas",
        body: "Keep it simple",
        color: "yellow",
      },
    },
    {
      id: "resource",
      kind: "resource",
      revision: 1,
      author_id: "me",
      data: {
        ...base,
        title: "Project site",
        resource: {
          kind: "website",
          status: "active",
          provider: "Static hosting",
          environment: "Production",
          public_url: "https://example.test",
          external_id: null,
        },
      },
    },
  ];
  let fail = false;
  const writes: Array<{
    id: string;
    revision: number;
    data: Record<string, unknown>;
  }> = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options?: RequestInit) => {
      if (options?.method === "PATCH") {
        const input = JSON.parse(String(options.body)),
          id = path.split("/").at(-1)!;
        writes.push({ id, ...input });
        if (fail)
          return {
            ok: false,
            status: 409,
            json: async () => ({
              error: {
                message: "Someone changed this item. Your draft is still here.",
              },
            }),
          };
        const existing = items.find((item) => item.id === id)!;
        const updated = {
          ...existing,
          revision: existing.revision + 1,
          data: { ...existing.data, ...input.data },
        };
        items = items.map((item) => (item.id === id ? updated : item));
        return { ok: true, status: 200, json: async () => updated };
      }
      return {
        ok: true,
        status: 200,
        json: async () =>
          path.endsWith("/members")
            ? {
                members: [{ id: "me", display_name: "Alex" }],
                actor: { id: "me" },
              }
            : path.endsWith("/statuses")
              ? {
                  can_manage: true,
                  statuses: [
                    {
                      id: "todo",
                      name: "To do",
                      category: "todo",
                      position: 0,
                    },
                    { id: "done", name: "Done", category: "done", position: 1 },
                  ],
                }
              : path.endsWith("/boards")
                ? { boards: [] }
                : path.endsWith("/edges")
                  ? { edges: [] }
                  : { items, next: null },
      };
    }),
  );
  return {
    writes,
    fail: () => {
      fail = true;
    },
  };
}

it("shows tasks, notes, resources and timeline together without a sync action", async () => {
  projectFixture();
  render(<ProjectsApp />);
  expect(await screen.findByText("Plan the release")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Notes & Resources" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Timeline" })).toBeInTheDocument();
  expect(screen.getByText("Keep it simple")).toBeInTheDocument();
  expect(screen.getByText("Project site")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /sync/i }),
  ).not.toBeInTheDocument();
});

it("autosaves a note with its observed revision and preserves a conflicting draft", async () => {
  const fixture = projectFixture();
  fixture.fail();
  render(<ProjectsApp />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit note text" }),
  );
  const text = screen.getByLabelText("Note text: Launch ideas");
  fireEvent.change(text, { target: { value: "My unsaved idea" } });
  await screen.findByText(
    "Someone changed this item. Your draft is still here.",
  );
  expect(text).toHaveValue("My unsaved idea");
  expect(fixture.writes).toHaveLength(1);
  expect(fixture.writes[0]).toMatchObject({
    id: "note",
    revision: 2,
    data: { body: "My unsaved idea" },
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("link", { name: "Graph" }));
  expect(confirm).toHaveBeenCalled();
  expect(text).toBeInTheDocument();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByText("Reload saved note"));
  expect(text).toHaveValue("Keep it simple");
});

it("moves a task using the selected status and current revision", async () => {
  const fixture = projectFixture();
  render(<ProjectsApp />);
  await screen.findByText("Plan the release");
  fireEvent.click(screen.getByRole("button", { name: "Move to…" }));
  fireEvent.change(screen.getByLabelText("Move Plan the release"), {
    target: { value: "done" },
  });
  await waitFor(() => expect(fixture.writes).toHaveLength(1));
  expect(fixture.writes[0]).toMatchObject({
    id: "task",
    revision: 3,
    data: { status_id: "done" },
  });
});

it("edits native resource fields inside the expanded paper card", async () => {
  const fixture = projectFixture();
  render(<ProjectsApp />);
  fireEvent.click(await screen.findByText("Project site"));
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.change(screen.getByLabelText("Provider"), {
    target: { value: "New hosting" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fixture.writes).toHaveLength(1));
  expect(fixture.writes[0]).toMatchObject({
    id: "resource",
    revision: 1,
    data: {
      resource: { provider: "New hosting", public_url: "https://example.test" },
    },
  });
});

it("opens paper notes and resource mentions, keeps tasks in the side pane, and attaches notes", async () => {
  const fixture = projectFixture();
  render(<ProjectsApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Expand note" }));
  const note = screen.getByRole("article", { name: "note: Launch ideas" });
  expect(note).toHaveClass("connected-paper");
  fireEvent.click(within(note).getByRole("button", { name: "Edit note text" }));
  const text = within(note).getByLabelText("Note text: Launch ideas");
  fireEvent.change(text, {
    target: { value: "See !Project", selectionStart: 12 },
  });
  fireEvent.click(within(note).getByRole("option", { name: "Project site" }));
  expect(text).toHaveValue("See [Project site](#resource-resource)");
  await waitFor(() => expect(fixture.writes).toHaveLength(1));
  fireEvent.blur(text);
  fireEvent.click(within(note).getByRole("link", { name: "Project site" }));
  const resource = screen.getByRole("article", {
    name: "resource: Project site",
  });
  expect(resource).toHaveClass("connected-paper");
  fireEvent.click(within(resource).getByRole("button", { name: "Notes" }));
  fireEvent.change(within(resource).getByLabelText("Attach a note"), {
    target: { value: "note" },
  });
  await waitFor(() =>
    expect(
      fixture.writes.some((write) => write.data.resource_id === "resource"),
    ).toBe(true),
  );
  fireEvent.click(screen.getByText("Plan the release"));
  expect(screen.getByRole("complementary", { name: "Edit task" })).toHaveClass(
    "project-item-pane",
  );
});
