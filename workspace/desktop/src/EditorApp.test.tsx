import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorApp } from "./EditorApp";

afterEach(cleanup);

describe("Editor app prototype", () => {
  it("tracks edits and exposes the save integration callback", () => {
    const onSave = vi.fn();
    render(<EditorApp onSave={onSave} />);

    const editor = screen.getByRole("textbox", { name: "Code editor for workflow-agent.ts" });
    fireEvent.change(editor, { target: { value: `${(editor as HTMLTextAreaElement).value}\n// local change` } });

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "workflow-agent" }), expect.stringContaining("local change"));
    expect(save).toBeDisabled();
  });

  it("switches a Markdown document from source to preview", () => {
    render(<EditorApp />);

    fireEvent.click(screen.getByRole("tab", { name: "brief.md" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByRole("heading", { name: "Build the next interface" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Code editor for brief.md" })).not.toBeInTheDocument();
  });

  it("opens a dynamically loaded workspace document", async () => {
    const { rerender } = render(<EditorApp documents={[]} activeDocumentId="notes.md" workspaceName="Workspace" />);
    expect(screen.getByText("Open a text file from Files to begin editing.")).toBeInTheDocument();

    rerender(<EditorApp documents={[{
      id: "notes.md",
      name: "notes.md",
      path: "notes.md",
      language: "markdown",
      accent: "violet",
      content: "# Shared notes\n",
      version: "a".repeat(43),
    }]} activeDocumentId="notes.md" workspaceName="Workspace" />);

    expect(await screen.findByRole("textbox", { name: "Code editor for notes.md" })).toHaveValue("# Shared notes\n");
  });

  it("gives an empty editor a clear handoff to Files", () => {
    const onOpenFile = vi.fn();
    render(<EditorApp documents={[]} workspaceName="Workspace" onOpenFile={onOpenFile} />);

    expect(screen.getByText("Open a file to start editing")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Editor context" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Browse files" }).at(-1)!);
    expect(onOpenFile).toHaveBeenCalledOnce();
  });

  it("keeps a document dirty when an asynchronous save fails", async () => {
    const onSave = vi.fn(async () => { throw new Error("This file changed after you opened it. Reload it before saving"); });
    render(<EditorApp onSave={onSave} />);
    const editor = screen.getByRole("textbox", { name: "Code editor for workflow-agent.ts" });
    fireEvent.change(editor, { target: { value: `${(editor as HTMLTextAreaElement).value}\n// conflicting change` } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/This file changed after you opened it/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
  });

  it("reloads the active file from the shared workspace", async () => {
    const document = {
      id: "notes.md", name: "notes.md", path: "notes.md", language: "markdown" as const,
      accent: "violet" as const, content: "# Old notes\n", version: "a".repeat(43),
    };
    const onReload = vi.fn(async () => ({ ...document, content: "# Teammate update\n", version: "b".repeat(43) }));
    render(<EditorApp documents={[document]} activeDocumentId="notes.md" onReload={onReload} />);

    fireEvent.click(screen.getByRole("button", { name: "Reload file" }));

    expect(await screen.findByRole("textbox", { name: "Code editor for notes.md" })).toHaveValue("# Teammate update\n");
    expect(onReload).toHaveBeenCalledWith(expect.objectContaining({ version: "a".repeat(43) }));
  });
});
