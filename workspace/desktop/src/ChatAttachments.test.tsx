import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageAttachments, SaveAttachmentDialog } from "./ChatAttachments";
import { readDeviceState, writeDeviceState } from "./deviceState";
import * as files from "./filesApi";
import * as explorer from "./explorerApi";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
const image = { name: "photo.png", path: "uploads/photo.png", type: "image/png", size: 2048 };
const directory = { path: "Downloads", parent: "", entries: [] };

describe("chat attachment actions", () => {
  it("previews images without visible filename metadata and restores focus", () => {
    render(<MessageAttachments attachments={[image]} />);
    expect(screen.queryByText("photo.png")).not.toBeInTheDocument();
    expect(screen.queryByText("2 KB")).not.toBeInTheDocument();
    const preview = screen.getByRole("button", { name: "Preview photo.png" });
    preview.focus(); fireEvent.click(preview);
    const dialog = screen.getByRole("dialog", { name: "Image preview" });
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", "/workspace/api/files/content?path=uploads%2Fphoto.png");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(preview).toHaveFocus();
  });

  it("opens the same download menu with right-click and keyboard", () => {
    render(<MessageAttachments attachments={[image]} />);
    fireEvent.contextMenu(screen.getByRole("img"), { clientX: 40, clientY: 20 });
    expect(screen.getByRole("menuitem", { name: "Download to Workspace" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: /^Download$/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.getByRole("button", { name: "Actions for photo.png" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "Actions for photo.png" }), { key: "ArrowDown" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("uses workspace copy operations and records the saved destination", async () => {
    vi.spyOn(files, "listWorkspaceDirectory").mockResolvedValue(directory);
    const start = vi.spyOn(explorer, "startOperation").mockResolvedValue({ id: "job", state: "finished", bytes: 1, completed: 1, total: 1, results: [{ status: "completed", destination: "Downloads/photo.png" }] });
    const notify = vi.fn();
    render(<MessageAttachments attachments={[image]} notify={notify} storageNamespace="download-user" />);
    fireEvent.click(screen.getByRole("button", { name: "Actions for photo.png" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Download to Workspace" }));
    const save = await screen.findByRole("button", { name: "Save" });
    await waitFor(() => expect(save).toBeEnabled()); fireEvent.click(save);
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Saved to Workspace: Downloads/photo.png"));
    expect(start).toHaveBeenCalledWith([{ action: "copy", path: image.path, destination: "Downloads", name: image.name, conflict: undefined }]);
    expect(readDeviceState("download-user", "chat-downloads")).toEqual({ directory: "Downloads" });
  });

  it("refreshes expired private-media tickets once before retrying a save", async () => {
    vi.spyOn(files, "listWorkspaceDirectory").mockResolvedValue(directory);
    const request = vi.spyOn(files, "requestJson").mockRejectedValueOnce(Object.assign(new Error("expired"), { status: 404 })).mockResolvedValueOnce({ item: { path: "Downloads/photo.png" } });
    const original = { name: image.name, type: image.type, artifactId: "artifact", url: "/workspace/api/neura/media/outgoing/chat/id/full?mediaTicket=old" };
    const refreshed = { ...original, url: original.url.replace("old", "new") };
    const refresh = vi.fn().mockResolvedValue(refreshed);
    const notify = vi.fn();
    render(<MessageAttachments attachments={[original]} refreshAttachment={refresh} notify={notify} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions for photo.png" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Download to Workspace" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalledOnce();
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toMatchObject({ mediaUrl: refreshed.url });
  });
});

describe("workspace save dialog", () => {
  it("asks about conflicts without replacing silently and keeps errors editable", async () => {
    vi.spyOn(files, "listWorkspaceDirectory").mockResolvedValue(directory);
    const onSave = vi.fn().mockRejectedValueOnce(Object.assign(new Error("Exists"), { code: "already_exists" })).mockResolvedValueOnce("Downloads/photo (2).png");
    render(<SaveAttachmentDialog name="photo.png" onClose={vi.fn()} onSave={onSave} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep both" }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith("Downloads", "photo.png", "keep-both"));
  });

  it("does not create Downloads until saving and falls back from a deleted remembered folder", async () => {
    writeDeviceState("user", "chat-downloads", { directory: "Gone" });
    vi.spyOn(files, "listWorkspaceDirectory").mockRejectedValue(Object.assign(new Error("Missing"), { code: "not_found" }));
    const create = vi.spyOn(files, "createWorkspaceFolder").mockResolvedValue({ item: {} as files.WorkspaceEntry });
    render(<SaveAttachmentDialog name="photo.png" storageNamespace="user" onClose={vi.fn()} onSave={vi.fn().mockResolvedValue("Downloads/photo.png")} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByText("Folder: Downloads")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("", "Downloads"));
  });

  it("prevents duplicate saves and disables replacement of the source file", async () => {
    vi.spyOn(files, "listWorkspaceDirectory").mockResolvedValue(directory);
    let reject!: (error: unknown) => void;
    const onSave = vi.fn(() => new Promise<string>((_, fail) => { reject = fail; }));
    render(<SaveAttachmentDialog name="photo.png" sourcePath="Downloads/photo.png" onClose={vi.fn()} onSave={onSave} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    const button = screen.getByRole("button", { name: "Save" }); fireEvent.click(button); fireEvent.click(button);
    expect(onSave).toHaveBeenCalledOnce();
    reject(Object.assign(new Error("Already here"), { code: "already_exists" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Replace" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Keep both" })).toBeEnabled();
  });
});
