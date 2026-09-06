import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilesApp } from "./FilesApp";
import * as api from "./explorerApi";
import * as files from "./filesApi";
import { normalizedPath } from "./ExplorerApp";

vi.mock("./explorerApi", () => ({
  preferences: vi.fn(),
  savePins: vi.fn(),
  getListing: vi.fn(),
  getRecent: vi.fn(),
  getTrash: vi.fn(),
  searchFiles: vi.fn(),
  recordOpen: vi.fn(),
  startOperation: vi.fn(),
  getOperation: vi.fn(),
  getOperations: vi.fn(),
  cancelOperation: vi.fn(),
  fileInfo: vi.fn(),
  transferUpload: vi.fn(),
}));
vi.mock("./filesApi", async (original) => ({
  ...(await original<typeof files>()),
  subscribeWorkspaceFiles: vi.fn(),
  createWorkspaceFolder: vi.fn(),
  createWorkspaceTextFile: vi.fn(),
}));
const folder = {
  name: "projects",
  path: "projects",
  type: "folder" as const,
  size: null,
  modifiedAt: "2026-09-01T12:00:00Z",
  mimeType: null,
};
const note = {
  name: "notes.md",
  path: "notes.md",
  type: "file" as const,
  size: 20,
  modifiedAt: "2026-09-01T12:00:00Z",
  mimeType: "text/markdown",
  version: "v1",
};
const photo = {
  ...note,
  name: "photo.png",
  path: "photo.png",
  mimeType: "image/png",
};
let live = [folder, note, photo];
let change: (event: files.WorkspaceFileChange) => void;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  live = [folder, note, photo];
  vi.stubGlobal("EventSource", class {});
  vi.mocked(files.subscribeWorkspaceFiles).mockImplementation((listener) => {
    change = listener;
    return () => {};
  });
  vi.mocked(api.preferences).mockResolvedValue({
    revision: 0,
    pins: [],
    recent: [],
  });
  vi.mocked(api.getOperations).mockResolvedValue({ operations: [] });
  vi.mocked(api.savePins).mockImplementation(async (_, pins) => ({
    revision: 1,
    pins,
    recent: [],
  }));
  vi.mocked(api.getListing).mockImplementation(async (options) => ({
    entries:
      options.path === "projects"
        ? [{ ...note, path: "projects/notes.md" }]
        : live,
    nextOffset: null,
  }));
  vi.mocked(api.searchFiles).mockResolvedValue({
    entries: [note],
    cursor: null,
  });
  vi.mocked(api.getRecent).mockResolvedValue({ entries: [note] });
  vi.mocked(api.getTrash).mockResolvedValue({ entries: [] });
  vi.mocked(api.startOperation).mockResolvedValue({
    id: "job",
    state: "finished",
    completed: 1,
    total: 1,
    bytes: 20,
    results: [{ status: "completed" }],
  });
  vi.mocked(files.createWorkspaceFolder).mockResolvedValue({ item: folder });
  vi.mocked(files.createWorkspaceTextFile).mockResolvedValue({
    item: note,
    content: "",
    version: "v1",
  });
  vi.mocked(api.fileInfo).mockResolvedValue({ item: folder });
  vi.mocked(api.transferUpload).mockResolvedValue({ item: photo });
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const row = (name: string) =>
  screen.findByRole("row", { name: new RegExp(`^${name},`) });
async function menu(name: string, action: string) {
  fireEvent.click(
    screen.getByRole("button", { name: `More actions for ${name}` }),
  );
  fireEvent.click(
    within(screen.getByRole("menu")).getByRole("menuitem", { name: action }),
  );
}

describe("Files explorer", () => {
  it("uses one listing, opens folders, and restores Back/Forward locations", async () => {
    render(<FilesApp />);
    fireEvent.doubleClick(await row("projects"));
    await waitFor(() =>
      expect(api.getListing).toHaveBeenLastCalledWith(
        expect.objectContaining({ path: "projects" }),
        expect.any(AbortSignal),
      ),
    );
    expect(
      screen.queryByRole("heading", { name: "Folders" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await row("projects");
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() =>
      expect(api.getListing).toHaveBeenLastCalledWith(
        expect.objectContaining({ path: "projects" }),
        expect.any(AbortSignal),
      ),
    );
  });
  it("pins folders from a real row menu and unpins without deleting", async () => {
    render(<FilesApp storageNamespace="alice" />);
    await row("projects");
    await menu("projects", "Pin to sidebar");
    await waitFor(() =>
      expect(api.savePins).toHaveBeenCalledWith(expect.anything(), [
        { path: "projects", label: "projects" },
      ]),
    );
    const pins = screen.getByLabelText("Pinned folders");
    fireEvent.contextMenu(
      await within(pins).findByRole("button", { name: "projects" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Unpin from sidebar" }),
    );
    await waitFor(() =>
      expect(api.savePins).toHaveBeenLastCalledWith(expect.anything(), []),
    );
    expect(api.startOperation).not.toHaveBeenCalled();
  });
  it("selects ranges and copies multiple entries to another directory", async () => {
    render(<FilesApp />);
    fireEvent.click(await row("notes.md"));
    fireEvent.click(await row("photo.png"), { shiftKey: true });
    expect(screen.getByText(/2 selected/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    fireEvent.doubleClick(await row("projects"));
    await waitFor(() =>
      expect(api.getListing).toHaveBeenLastCalledWith(
        expect.objectContaining({ path: "projects" }),
        expect.any(AbortSignal),
      ),
    );
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    await waitFor(() =>
      expect(api.startOperation).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            action: "copy",
            path: "notes.md",
            destination: "projects",
          }),
          expect.objectContaining({
            action: "copy",
            path: "photo.png",
            destination: "projects",
          }),
        ]),
      ),
    );
  });
  it("keeps sorting separate from navigation and clears invisible selections on search", async () => {
    render(<FilesApp />);
    fireEvent.click(await row("photo.png"));
    fireEvent.click(screen.getByRole("button", { name: "Toggle details" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), {
      target: { value: "size" },
    });
    await waitFor(() =>
      expect(api.getListing).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "size", path: "" }),
        expect.anything(),
      ),
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "notes" },
    });
    await row("notes.md");
    expect(
      screen.queryByRole("heading", { name: "photo.png" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(api.searchFiles).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "recursive", q: "notes" }),
        expect.anything(),
      ),
    );
    expect(api.getRecent).not.toHaveBeenCalled();
  });
  it("opens text with Enter, images in Preview, and images in the editor explicitly", async () => {
    const code = vi.fn(),
      preview = vi.fn(),
      editor = vi.fn();
    render(
      <FilesApp
        onOpenInVsCode={code}
        onPreviewFile={preview}
        onEditImage={editor}
      />,
    );
    fireEvent.click(await row("notes.md"));
    fireEvent.keyDown(window, { key: "Enter" });
    expect(code).toHaveBeenCalledWith("notes.md");
    fireEvent.doubleClick(await row("photo.png"));
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({ path: "photo.png" }),
    );
    await menu("photo.png", "Edit image");
    expect(editor).toHaveBeenCalledWith(
      expect.objectContaining({ path: "photo.png" }),
    );
  });
  it("ignores shortcuts in inactive windows and text inputs", async () => {
    const code = vi.fn();
    const app = render(<FilesApp active={false} onOpenInVsCode={code} />);
    fireEvent.click(await row("notes.md"));
    fireEvent.keyDown(window, { key: "Enter" });
    expect(code).not.toHaveBeenCalled();
    app.rerender(<FilesApp active onOpenInVsCode={code} />);
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Delete" });
    expect(api.startOperation).not.toHaveBeenCalled();
  });
  it("moves items to Trash and confirms permanent removal", async () => {
    render(<FilesApp />);
    await row("notes.md");
    await menu("notes.md", "Move to Trash");
    await waitFor(() =>
      expect(api.startOperation).toHaveBeenCalledWith([
        { action: "trash", path: "notes.md" },
      ]),
    );
    vi.mocked(api.getTrash).mockResolvedValue({
      entries: [
        {
          ...note,
          id: "trash-id",
          deletedBy: "alice",
          deletedAt: note.modifiedAt,
          expiresAt: "2026-12-01T12:00:00Z",
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Trash" }));
    await row("notes.md");
    await menu("notes.md", "Delete permanently");
    expect(
      screen.getByRole("dialog", { name: "Delete permanently?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.startOperation).toHaveBeenCalledTimes(1);
  });
  it("creates folders and text files without changing app integration", async () => {
    const code = vi.fn();
    render(<FilesApp onOpenInVsCode={code} />);
    await row("projects");
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "New folder" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "work" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(files.createWorkspaceFolder).toHaveBeenCalledWith("", "work"),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "New file" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(code).toHaveBeenCalledWith("notes.md"));
  });
  it("preserves a selected row through live reconciliation", async () => {
    render(<FilesApp />);
    const notes = await row("notes.md");
    fireEvent.click(notes);
    live = [...live, { ...note, path: "new.md", name: "new.md" }];
    act(() => change({ sequence: 1, paths: ["new.md"] }));
    await row("new.md");
    expect(await row("notes.md")).toHaveAttribute("aria-selected", "true");
  });
  it("opens a folder in a separate tab and restores saved tabs", async () => {
    const app = render(<FilesApp storageNamespace="alice" />);
    await row("projects");
    await menu("projects", "Open in new tab");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    app.unmount();
    render(<FilesApp storageNamespace="alice" />);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });
  it("uploads picked files and retains failed transfers for retry", async () => {
    render(<FilesApp />);
    await row("projects");
    vi.mocked(api.transferUpload).mockRejectedValueOnce(
      new Error("Connection lost"),
    );
    fireEvent.change(screen.getByLabelText("Choose files to upload"), {
      target: {
        files: [
          new globalThis.File(["abc"], "photo.png", { type: "image/png" }),
        ],
      },
    });
    expect(await screen.findByText("Connection lost")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry failed items" }));
    await waitFor(() => expect(api.transferUpload).toHaveBeenCalledTimes(2));
  });
  it("rejects paths outside the workspace", () => {
    expect(normalizedPath("~/workspace/projects")).toBe("projects");
    expect(() => normalizedPath("/etc")).toThrow();
    expect(() => normalizedPath("../other")).toThrow();
  });
  it("shares a personal clipboard across Files windows without sharing shortcuts", async () => {
    const windows = (firstActive: boolean) => (
      <>
        <div data-testid="source">
          <FilesApp
            storageNamespace="alice"
            storageArea="files.first"
            active={firstActive}
          />
        </div>
        <div data-testid="destination">
          <FilesApp
            storageNamespace="alice"
            storageArea="files.second"
            initialPath="projects"
            active={!firstActive}
          />
        </div>
      </>
    );
    const app = render(windows(true));
    fireEvent.click(
      await within(screen.getByTestId("source")).findByRole("row", {
        name: "notes.md, MD",
      }),
    );
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    app.rerender(windows(false));
    await within(screen.getByTestId("destination")).findByRole("row", {
      name: "notes.md, MD",
    });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    await waitFor(() =>
      expect(api.startOperation).toHaveBeenCalledWith([
        expect.objectContaining({
          action: "copy",
          path: "notes.md",
          destination: "projects",
        }),
      ]),
    );
  });
  it("keeps Recent and Trash in tab navigation history", async () => {
    render(<FilesApp />);
    await row("projects");
    fireEvent.click(screen.getByRole("button", { name: "Recent" }));
    await waitFor(() => expect(api.getRecent).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Trash" }));
    await waitFor(() => expect(api.getTrash).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      await screen.findByRole("region", { name: "Recent" }),
    ).toBeInTheDocument();
  });
  it("virtualizes a ten-thousand-entry folder", async () => {
    vi.mocked(api.getListing).mockResolvedValue({
      entries: Array.from({ length: 10000 }, (_, index) => ({
        ...note,
        name: `file-${index}.md`,
        path: `file-${index}.md`,
      })),
      nextOffset: null,
    });
    render(<FilesApp />);
    await row("file-0.md");
    expect(screen.getAllByRole("row").length).toBeLessThan(50);
    fireEvent.scroll(screen.getByRole("grid", { name: "Workspace items" }), {
      target: { scrollTop: 459500 },
    });
    await row("file-9999.md");
    expect(screen.getAllByRole("row").length).toBeLessThan(50);
  });
});
