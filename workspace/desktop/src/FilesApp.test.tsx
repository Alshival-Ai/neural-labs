import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FilesApp } from "./FilesApp";

const rootEntries = [
  { name: "projects", path: "projects", type: "folder", size: null, modifiedAt: "2026-09-01T12:00:00.000Z", mimeType: null },
  { name: "notes.md", path: "notes.md", type: "file", size: 2048, modifiedAt: "2026-09-01T12:05:00.000Z", mimeType: "text/markdown" },
];
const projectEntries = [
  { name: "index.html", path: "projects/index.html", type: "file", size: 1263, modifiedAt: "2026-09-01T12:10:00.000Z", mimeType: "text/html" },
];

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  private listeners = new Map<string, Set<EventListener>>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (typeof listener !== "function") return;
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (typeof listener === "function") this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, value: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(value) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  close() {}
}

let liveRootEntries = rootEntries;
let liveProjectEntries = projectEntries;
let pendingRootResponse: Promise<Response> | undefined;

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  liveRootEntries = rootEntries;
  liveProjectEntries = projectEntries;
  pendingRootResponse = undefined;
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "GET" && url.includes("path=projects")) {
      return json({ path: "projects", parent: "", entries: liveProjectEntries });
    }
    if (method === "GET") {
      if (pendingRootResponse) return pendingRootResponse;
      return json({ path: "", parent: null, entries: liveRootEntries });
    }
    if (method === "POST" && url.includes("/folders")) {
      return json({ item: { ...rootEntries[0], name: "new-folder", path: "new-folder" } }, 201);
    }
    if (method === "POST" && url.includes("/upload")) {
      return json({ item: { ...rootEntries[1], name: "upload.txt", path: "upload.txt" } }, 201);
    }
    if (method === "POST" && url.includes("/text")) {
      const item = { ...rootEntries[1], name: "new-note.md", path: "new-note.md", size: 0 };
      return json({ item, content: "", version: "a".repeat(43) }, 201);
    }
    if (method === "DELETE") return json({ deleted: true, path: "notes.md" });
    return json({ error: { message: "Unexpected test request" } }, 500);
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Files app", () => {
  it("loads the live directory, searches it, changes view, and opens folders", async () => {
    render(<FilesApp />);

    const notes = await screen.findByRole("button", { name: /notes\.md/i });
    expect(notes).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search workspace files" }), { target: { value: "notes" } });
    expect(screen.queryByRole("button", { name: /projects, folder/i })).not.toBeInTheDocument();

    const gridView = screen.getByRole("button", { name: "Grid view" });
    fireEvent.click(gridView);
    expect(gridView).toHaveAttribute("aria-pressed", "true");

    fireEvent.change(screen.getByRole("searchbox", { name: "Search workspace files" }), { target: { value: "" } });
    const browser = screen.getByRole("region", { name: "All files" });
    fireEvent.doubleClick(within(browser).getByRole("button", { name: /projects, folder/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("path=projects"), expect.any(Object)));
    expect(await screen.findByRole("heading", { name: "projects" })).toBeInTheDocument();
  });

  it("creates folders and creates text files that open in Editor", async () => {
    const onOpenFile = vi.fn();
    render(<FilesApp onOpenFile={onOpenFile} />);
    await screen.findByRole("button", { name: /notes\.md/i });

    fireEvent.click(screen.getAllByRole("button", { name: /^New$/ }).at(-1)!);
    fireEvent.click(screen.getByRole("menuitem", { name: /New folder/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "Folder name" }), { target: { value: "new-folder" } });
    fireEvent.click(screen.getByRole("button", { name: "Create folder" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/workspace/api/files/folders",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ path: "", name: "new-folder" }) }),
    ));
    expect(await screen.findByText("Folder “new-folder” created.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /^New$/ }).at(-1)!);
    fireEvent.click(screen.getByRole("menuitem", { name: /New file/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "File name" }), { target: { value: "new-note.md" } });
    fireEvent.click(screen.getByRole("button", { name: "Create file" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/workspace/api/files/text?"),
      expect.objectContaining({ method: "POST", body: "" }),
    ));
    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("new-note.md"));
  });

  it("opens a file in Editor from a double click and the context menu", async () => {
    const onOpenFile = vi.fn();
    render(<FilesApp onOpenFile={onOpenFile} />);
    const notes = await screen.findByRole("button", { name: /notes\.md/i });

    fireEvent.doubleClick(notes);
    expect(onOpenFile).toHaveBeenCalledWith("notes.md");

    fireEvent.contextMenu(notes, { clientX: 100, clientY: 120 });
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Open in Editor" }));
    expect(onOpenFile).toHaveBeenCalledTimes(2);
  });

  it("copies a file or folder workspace path from the context menu", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { userAgent: navigator.userAgent, clipboard: { writeText } });
    render(<FilesApp />);

    const notes = await screen.findByRole("button", { name: /notes\.md/i });
    fireEvent.contextMenu(notes, { clientX: 100, clientY: 120 });
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Copy path" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("~/workspace/notes.md"));
    expect(screen.getByRole("status")).toHaveTextContent("Copied ~/workspace/notes.md");

    const projects = screen.getByRole("button", { name: /projects, folder/i });
    fireEvent.contextMenu(projects, { clientX: 100, clientY: 120 });
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Copy path" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("~/workspace/projects"));
  });

  it("opens HTML files in a desktop preview", async () => {
    const onPreviewFile = vi.fn();
    render(<FilesApp onPreviewFile={onPreviewFile} />);
    const browser = screen.getByRole("region", { name: "All files" });
    fireEvent.doubleClick(await within(browser).findByRole("button", { name: /projects, folder/i }));

    const page = await within(screen.getByRole("region", { name: "All files" })).findByRole("button", { name: /^index\.html, Code/i });
    fireEvent.doubleClick(page);
    expect(onPreviewFile).toHaveBeenCalledWith({
      name: "index.html",
      path: "projects/index.html",
      size: 1263,
      mimeType: "text/html",
    });

    fireEvent.contextMenu(page, { clientX: 100, clientY: 120 });
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Open Preview" }));
    expect(onPreviewFile).toHaveBeenCalledTimes(2);
  });

  it("uploads dropped files and exposes download and delete in the context menu", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = render(<FilesApp />);
    const notes = await screen.findByRole("button", { name: /notes\.md/i });

    const uploaded = new File(["hello"], "upload.txt", { type: "text/plain" });
    fireEvent.drop(container.querySelector(".files-app")!, {
      dataTransfer: { files: [uploaded], types: ["Files"] },
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/workspace/api/files/upload?"),
      expect.objectContaining({ method: "POST", body: uploaded }),
    ));

    fireEvent.contextMenu(notes, { clientX: 100, clientY: 120 });
    const menu = screen.getByRole("menu");
    const download = within(menu).getByRole("menuitem", { name: "Download" });
    expect(download).toHaveAttribute("href", expect.stringContaining("notes.md"));
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete permanently" }));

    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/workspace/api/files?path=notes.md"),
      expect.objectContaining({ method: "DELETE" }),
    ));
  });

  it("does not reload when its parent supplies a new notification callback", async () => {
    const { rerender } = render(<FilesApp notify={() => undefined} />);
    await screen.findByRole("button", { name: /notes\.md/i });
    const callsBefore = vi.mocked(fetch).mock.calls.length;

    rerender(<FilesApp notify={() => undefined} />);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetch).toHaveBeenCalledTimes(callsBefore);
  });

  it("silently reconciles an external file event without replacing the file list", async () => {
    render(<FilesApp />);
    const notes = await screen.findByRole("button", { name: /notes\.md/i });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/workspace/api/files/events");

    let finishRefresh!: (response: Response) => void;
    pendingRootResponse = new Promise((resolve) => { finishRefresh = resolve; });
    liveRootEntries = [
      ...rootEntries,
      { name: "teammate.txt", path: "teammate.txt", type: "file", size: 12, modifiedAt: "2026-09-01T12:10:00.000Z", mimeType: "text/plain" },
    ];
    act(() => FakeEventSource.instances[0].emit("files-changed", { sequence: 1, paths: ["teammate.txt"] }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    expect(notes).toBeInTheDocument();
    expect(screen.queryByText("Loading workspace files")).not.toBeInTheDocument();
    pendingRootResponse = undefined;
    finishRefresh(json({ path: "", parent: null, entries: liveRootEntries }));

    expect(await screen.findByRole("button", { name: /teammate\.txt/i })).toBeInTheDocument();
  });
});
