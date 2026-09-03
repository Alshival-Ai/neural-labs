import {
  Bot,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Code2,
  Command,
  FileCode2,
  FileText,
  Files,
  Folder,
  FolderOpen,
  GitBranch,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  PanelRight,
  Play,
  Plus,
  RotateCw,
  Save,
  Search,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { readDeviceState, writeDeviceState } from "./deviceState";
import "./editor-app.css";

export type EditorAccent = "cyan" | "violet" | "pink" | "coral" | "amber" | "mint";
export type EditorLanguage =
  | "typescript" | "javascript" | "markdown" | "css" | "json" | "html"
  | "python" | "shell" | "yaml" | "plaintext";

export type EditorDocument = {
  id: string;
  name: string;
  path: string;
  language: EditorLanguage;
  accent: EditorAccent;
  content: string;
  savedContent?: string;
  version?: string;
};

export type EditorAppProps = {
  documents?: readonly EditorDocument[];
  activeDocumentId?: string;
  workspaceName?: string;
  onChange?: (document: EditorDocument, content: string) => void;
  onOpenFile?: () => void;
  onReload?: (document: EditorDocument) => EditorDocument | Promise<EditorDocument>;
  onRun?: (document: EditorDocument, content: string) => void;
  onSave?: (document: EditorDocument, content: string) => void | Promise<void>;
  storageNamespace?: string;
  storageArea?: string;
};

type EditorDeviceState = {
  activeId?: string;
  openIds: string[];
  sidebarMode: SidebarMode;
  rightPanel: RightPanel;
  viewMode: ViewMode;
  rightPanelOpen: boolean;
};

function editorDeviceState(storageNamespace: string | undefined, storageArea: string, documents: readonly EditorDocument[]): EditorDeviceState {
  const stored = readDeviceState(storageNamespace, storageArea);
  const fallback: EditorDeviceState = { activeId: documents[0]?.id, openIds: documents.slice(0, 4).map((document) => document.id), sidebarMode: "explorer", rightPanel: "outline", viewMode: "source", rightPanelOpen: documents.length > 0 };
  if (!stored || typeof stored !== "object") return fallback;
  const value = stored as Record<string, unknown>;
  const available = new Set(documents.map((document) => document.id));
  const openIds = Array.isArray(value.openIds) ? value.openIds.filter((id): id is string => typeof id === "string" && available.has(id)).slice(0, 20) : fallback.openIds;
  const activeId = typeof value.activeId === "string" && available.has(value.activeId) ? value.activeId : openIds[0] ?? fallback.activeId;
  return {
    activeId,
    openIds: openIds.length ? openIds : fallback.openIds,
    sidebarMode: ["explorer", "search"].includes(String(value.sidebarMode)) ? value.sidebarMode as SidebarMode : "explorer",
    rightPanel: ["outline", "neura"].includes(String(value.rightPanel)) ? value.rightPanel as RightPanel : "outline",
    viewMode: value.viewMode === "preview" ? "preview" : "source",
    rightPanelOpen: value.rightPanelOpen !== false,
  };
}

// Prototype-only documents. Integration can replace these with files opened from the shared workspace.
export const PLACEHOLDER_EDITOR_DOCUMENTS: readonly EditorDocument[] = [
  {
    id: "workflow-agent",
    name: "workflow-agent.ts",
    path: "atlas/src/agents/workflow-agent.ts",
    language: "typescript",
    accent: "cyan",
    content: `import { Neura } from "@neural-labs/runtime";
import type { TeamContext, WorkflowPlan } from "../types";

const MAX_PARALLEL_MOVES = 3;

export async function planWorkflow(
  brief: string,
  context: TeamContext,
): Promise<WorkflowPlan> {
  const neura = new Neura({
    workspace: context.workspace,
    skills: context.sharedSkills,
  });

  const plan = await neura.plan({
    brief,
    constraints: context.guardrails,
    parallelism: MAX_PARALLEL_MOVES,
  });

  return {
    ...plan,
    status: "ready-for-review",
    collaborators: context.activeMembers,
  };
}

// Keep the handoff legible before automating it.
export const summarizePlan = (plan: WorkflowPlan) =>
  plan.moves.map((move, index) => \`\${index + 1}. \${move.title}\`).join("\\n");`,
  },
  {
    id: "brief",
    name: "brief.md",
    path: "atlas/brief.md",
    language: "markdown",
    accent: "violet",
    content: `# Build the next interface

Make the workspace feel **clear, fast, and alive**.

## Product intent

Atlas is a shared team workspace built on OpenClaw. It should make it natural to:

- automate repeatable workflows;
- share useful skills and context;
- develop alongside people and agents;
- keep decisions close to the work.

## Current move

Create a focused editor that feels at home inside Neural Labs without becoming another generic IDE clone.

> Color is information. The interface stays quiet until something needs attention.`,
  },
  {
    id: "theme",
    name: "theme.css",
    path: "atlas/src/ui/theme.css",
    language: "css",
    accent: "pink",
    content: `:root {
  --ink: #0b0c11;
  --paper: #f6f4ef;
  --cyan: #08a9ef;
  --violet: #7b4dff;
  --pink: #f23aa9;
  --amber: #ffb80f;
}

.workspace-surface {
  color: var(--ink);
  background:
    radial-gradient(circle at 90% 0, rgb(8 169 239 / 8%), transparent 22rem),
    var(--paper);
}

.active-file {
  border-inline-start: 3px solid var(--cyan);
}`,
  },
  {
    id: "readme",
    name: "README.md",
    path: "atlas/README.md",
    language: "markdown",
    accent: "amber",
    content: `# Atlas

Shared product workspace for the Neural Labs team.

## Start here

1. Read the product brief.
2. Check active automations.
3. Ask Neura for the latest project context.
4. Leave the workspace clearer than you found it.
`,
  },
  {
    id: "manifest",
    name: "workspace.json",
    path: "atlas/workspace.json",
    language: "json",
    accent: "coral",
    content: `{
  "name": "Atlas",
  "status": "in-motion",
  "agent": "Neura",
  "skills": ["research", "planning", "implementation"],
  "shared": true
}`,
  },
];

type SidebarMode = "explorer" | "search";
type RightPanel = "outline" | "neura";
type ViewMode = "source" | "preview";

type OutlineEntry = { label: string; line: number; kind: "heading" | "function" | "symbol" };

const FILE_ICONS: Record<EditorLanguage, LucideIcon> = {
  typescript: Braces,
  javascript: Braces,
  markdown: FileText,
  css: Code2,
  json: Braces,
  html: Code2,
  python: Braces,
  shell: Command,
  yaml: Braces,
  plaintext: FileText,
};

function languageLabel(language: EditorLanguage): string {
  return ({
    typescript: "TypeScript",
    javascript: "JavaScript",
    markdown: "Markdown",
    css: "CSS",
    json: "JSON",
    html: "HTML",
    python: "Python",
    shell: "Shell",
    yaml: "YAML",
    plaintext: "Plain text",
  })[language];
}

function documentOutline(document: EditorDocument, content: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  content.split("\n").forEach((line, index) => {
    if (document.language === "markdown") {
      const heading = line.match(/^#{1,6}\s+(.+)$/);
      if (heading) entries.push({ label: heading[1], line: index + 1, kind: "heading" });
      return;
    }
    if (document.language === "typescript" || document.language === "javascript") {
      const symbol = line.match(/(?:function|const|interface|type|class)\s+([A-Za-z0-9_]+)/);
      if (symbol) entries.push({ label: symbol[1], line: index + 1, kind: line.includes("function") ? "function" : "symbol" });
      return;
    }
    if (document.language === "css") {
      const selector = line.match(/^\s*([^@][^{]+)\s*\{$/);
      if (selector) entries.push({ label: selector[1].trim(), line: index + 1, kind: "symbol" });
      return;
    }
    const key = line.match(/^\s*"([^"]+)"\s*:/);
    if (key) entries.push({ label: key[1], line: index + 1, kind: "symbol" });
  });
  return entries;
}

function highlightLine(line: string, language: EditorLanguage): ReactNode {
  if (language === "markdown") {
    const heading = line.match(/^(\s*)(#{1,6})(\s+.*)$/);
    if (heading) return <>{heading[1]}<span className="editor-token--keyword">{heading[2]}</span><span className="editor-token--type">{heading[3]}</span></>;
  }

  const matcher = /(\/\/.*$|\/\*.*?\*\/|`(?:\\.|[^`])*`|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\b(?:import|from|export|default|async|await|function|return|const|let|var|new|class|interface|type|extends|implements|if|else|for|of|in|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b|\b[A-Z][A-Za-z0-9_]*\b)/g;
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(line)) !== null) {
    if (match.index > cursor) parts.push(line.slice(cursor, match.index));
    const value = match[0];
    const tone = value.startsWith("//") || value.startsWith("/*")
      ? "comment"
      : value.startsWith("\"") || value.startsWith("'") || value.startsWith("`")
        ? "string"
        : /^\d/.test(value)
          ? "number"
          : /^[A-Z]/.test(value)
            ? "type"
            : "keyword";
    parts.push(<span className={`editor-token--${tone}`} key={`${match.index}-${value}`}>{value}</span>);
    cursor = match.index + value.length;
  }
  if (cursor < line.length) parts.push(line.slice(cursor));
  return parts.length ? parts : line || " ";
}

export function EditorApp({
  documents = PLACEHOLDER_EDITOR_DOCUMENTS,
  activeDocumentId,
  workspaceName = "Atlas",
  onChange,
  onOpenFile,
  onReload,
  onRun,
  onSave,
  storageNamespace,
  storageArea = "editor",
}: EditorAppProps) {
  const [initialUiState] = useState(() => editorDeviceState(storageNamespace, storageArea, documents));
  const [activeId, setActiveId] = useState(initialUiState.activeId);
  const [openIds, setOpenIds] = useState(initialUiState.openIds);
  const [contents, setContents] = useState<Record<string, string>>(() => Object.fromEntries(documents.map((document) => [document.id, document.content])));
  const [savedContents, setSavedContents] = useState<Record<string, string>>(() => Object.fromEntries(documents.map((document) => [document.id, document.savedContent ?? document.content])));
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(initialUiState.sidebarMode);
  const [rightPanel, setRightPanel] = useState<RightPanel>(initialUiState.rightPanel);
  const [viewMode, setViewMode] = useState<ViewMode>(initialUiState.viewMode);
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(initialUiState.rightPanelOpen);
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const documentIdSignature = documents.map((document) => document.id).join("\n");

  useEffect(() => {
    writeDeviceState(storageNamespace, storageArea, {
      activeId,
      openIds: openIds.filter((id) => documents.some((document) => document.id === id)),
      sidebarMode,
      rightPanel,
      viewMode,
      rightPanelOpen,
    } satisfies EditorDeviceState);
  }, [activeId, documentIdSignature, openIds, rightPanel, rightPanelOpen, sidebarMode, storageArea, storageNamespace, viewMode]);

  useEffect(() => {
    setContents((current) => {
      const next = { ...current };
      for (const document of documents) {
        next[document.id] = document.content;
      }
      return next;
    });
    setSavedContents((current) => {
      const next = { ...current };
      for (const document of documents) {
        next[document.id] = document.savedContent ?? document.content;
      }
      return next;
    });
  }, [documents]);

  useEffect(() => {
    if (!activeDocumentId || !documents.some((document) => document.id === activeDocumentId)) return;
    setOpenIds((current) => current.includes(activeDocumentId) ? current : [...current, activeDocumentId]);
    setActiveId(activeDocumentId);
    setViewMode("source");
  }, [activeDocumentId, documents]);

  const activeDocument = activeId ? documents.find((document) => document.id === activeId) : undefined;
  const activeContent = activeDocument ? contents[activeDocument.id] ?? activeDocument.content : "";
  const isDirty = Boolean(activeDocument && activeContent !== savedContents[activeDocument.id]);
  const openDocuments = openIds.flatMap((id) => {
    const document = documents.find((item) => item.id === id);
    return document ? [document] : [];
  });
  const filteredDocuments = documents.filter((document) => document.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const outline = useMemo(
    () => activeDocument ? documentOutline(activeDocument, activeContent) : [],
    [activeContent, activeDocument],
  );

  const selectDocument = (document: EditorDocument) => {
    setOpenIds((current) => current.includes(document.id) ? current : [...current, document.id]);
    setActiveId(document.id);
    setViewMode("source");
    setMobileSidebar(false);
    setNotice(undefined);
  };

  const closeDocument = (id: string) => {
    setOpenIds((current) => {
      const index = current.indexOf(id);
      const next = current.filter((item) => item !== id);
      if (activeId === id) setActiveId(next[Math.min(index, next.length - 1)]);
      return next;
    });
  };

  const saveDocument = useCallback(() => {
    if (!activeDocument || saving || !isDirty) return;
    const markSaved = () => {
      setSavedContents((current) => ({ ...current, [activeDocument.id]: activeContent }));
      setNotice(`${activeDocument.name} saved to the shared workspace.`);
    };
    try {
      const result = onSave?.(activeDocument, activeContent);
      if (result instanceof Promise) {
        setSaving(true);
        void result.then(markSaved).catch((error: unknown) => {
          setNotice(error instanceof Error ? error.message : `Could not save ${activeDocument.name}.`);
        }).finally(() => setSaving(false));
      } else if (onSave) markSaved();
      else {
        setSavedContents((current) => ({ ...current, [activeDocument.id]: activeContent }));
        setNotice(`${activeDocument.name} saved in this prototype session.`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `Could not save ${activeDocument.name}.`);
    }
  }, [activeContent, activeDocument, isDirty, onSave, saving]);

  useEffect(() => {
    const keyboard = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      saveDocument();
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [saveDocument]);

  const runDocument = () => {
    if (!activeDocument) return;
    if (onRun) onRun(activeDocument, activeContent);
    else setNotice(`Run ${activeDocument.name} is ready for the workspace runtime.`);
  };

  const reloadDocument = () => {
    if (!activeDocument || reloading) return;
    if (isDirty && !window.confirm(`Discard your unsaved changes to “${activeDocument.name}” and reload it?`)) return;
    if (!onReload) {
      setContents((current) => ({ ...current, [activeDocument.id]: savedContents[activeDocument.id] ?? activeDocument.content }));
      return;
    }
    setReloading(true);
    let result: EditorDocument | Promise<EditorDocument>;
    try {
      result = onReload(activeDocument);
    } catch (error) {
      setReloading(false);
      setNotice(error instanceof Error ? error.message : `Could not reload ${activeDocument.name}.`);
      return;
    }
    void Promise.resolve(result).then((reloaded) => {
      setContents((current) => ({ ...current, [activeDocument.id]: reloaded.content }));
      setSavedContents((current) => ({ ...current, [activeDocument.id]: reloaded.content }));
      setNotice(`${activeDocument.name} reloaded from the shared workspace.`);
    }).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : `Could not reload ${activeDocument.name}.`);
    }).finally(() => setReloading(false));
  };

  const chooseSidebar = (mode: SidebarMode) => {
    setSidebarMode(mode);
    setMobileSidebar(true);
  };

  const jumpToLine = (line: number) => {
    if (!editorRef.current) return;
    const position = activeContent.split("\n").slice(0, line - 1).reduce((total, value) => total + value.length + 1, 0);
    editorRef.current.focus();
    editorRef.current.setSelectionRange(position, position);
  };

  return (
    <div className={`editor-app${rightPanelOpen && activeDocument ? " editor-app--context-open" : ""}${activeDocument ? "" : " editor-app--empty"}`}>
      {mobileSidebar && <button type="button" className="editor-app__scrim" aria-label="Close editor sidebar" onClick={() => setMobileSidebar(false)} />}

      <aside className={`editor-sidebar${mobileSidebar ? " editor-sidebar--open" : ""}`} aria-label="Editor navigation">
        <nav className="editor-activity" aria-label="Editor tools">
          <div className="editor-activity__brand">E</div>
          <button type="button" aria-label="Explorer" aria-pressed={sidebarMode === "explorer"} onClick={() => chooseSidebar("explorer")}><Files /></button>
          <button type="button" aria-label="Search files" aria-pressed={sidebarMode === "search"} onClick={() => chooseSidebar("search")}><Search /></button>
          <button type="button" aria-label="Source control" onClick={() => setNotice("Source control is a placeholder tool.")}><GitBranch /></button>
          <button type="button" aria-label="Neura actions" onClick={() => { setRightPanel("neura"); setRightPanelOpen(true); }}><Sparkles /></button>
          <button type="button" className="editor-activity__bottom" aria-label="More editor actions" onClick={() => setNotice("More editor actions are ready to connect.")}><MoreHorizontal /></button>
        </nav>

        <div className="editor-explorer">
          <header className="editor-explorer__heading">
            <div><span>{sidebarMode === "explorer" ? "Explorer" : "Search"}</span><strong>{workspaceName}</strong></div>
            <button type="button" aria-label="Close sidebar" onClick={() => setMobileSidebar(false)}><X /></button>
          </header>

          {sidebarMode === "search" ? (
            <div className="editor-search-panel">
              <label><Search /><span className="editor-sr-only">Search files by name</span><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search files" type="search" /></label>
              <span>{filteredDocuments.length} matches</span>
              <div className="editor-search-results">
                {filteredDocuments.map((document) => <EditorFileButton document={document} active={document.id === activeId} key={document.id} onClick={() => selectDocument(document)} compact />)}
              </div>
            </div>
          ) : (
            <>
              <section className="editor-open-files" aria-labelledby="editor-open-heading">
                <div className="editor-tree-heading"><span id="editor-open-heading"><ChevronDown />Open editors</span><button type="button" aria-label="Open a file" onClick={() => onOpenFile ? onOpenFile() : setNotice("Open file is ready for the Files app handoff.")}><Plus /></button></div>
                {openDocuments.map((document) => <EditorFileButton document={document} active={document.id === activeId} dirty={(contents[document.id] ?? document.content) !== savedContents[document.id]} key={document.id} onClick={() => selectDocument(document)} />)}
              </section>
              <section className="editor-tree" aria-label={`${workspaceName} files`}>
                <div className="editor-tree-heading"><span><ChevronDown /><FolderOpen />{workspaceName}</span><small>live</small></div>
                {documents.length ? documents.map((document) => <EditorFileButton document={document} active={document.id === activeId} key={document.id} onClick={() => selectDocument(document)} compact />) : <div className="editor-tree__empty"><p>Open a text file from Files to begin editing.</p><button type="button" onClick={() => onOpenFile ? onOpenFile() : setNotice("Open file is ready for the Files app handoff.")}><FolderOpen />Browse files</button></div>}
              </section>
              <div className="editor-explorer__shared"><CircleDot /><span><strong>Shared workspace</strong><small>Changes are saved for the approved team</small></span></div>
            </>
          )}
        </div>
      </aside>

      <main className="editor-workspace">
        <header className="editor-toolbar">
          <button type="button" className="editor-icon-button editor-toolbar__menu" aria-label="Open editor navigation" onClick={() => setMobileSidebar(true)}><Menu /></button>
          <div className="editor-breadcrumb" aria-label="Current document path">
            <span>{workspaceName}</span>{activeDocument && <><ChevronRight /><strong>{activeDocument.path}</strong></>}
          </div>
          <div className="editor-presence" aria-label="Shared team editor"><CircleDot /><span>Shared</span></div>
          {activeDocument ? <>
            <button type="button" className="editor-icon-button" aria-label="Reload file" disabled={reloading} onClick={reloadDocument}><RotateCw /></button>
            {onRun && <button type="button" className="editor-run" onClick={runDocument}><Play />Run</button>}
            <button type="button" className="editor-save" disabled={!isDirty || saving} onClick={saveDocument}><Save />{saving ? "Saving…" : "Save"}</button>
          </> : <button type="button" className="editor-open-file" onClick={() => onOpenFile ? onOpenFile() : setNotice("Open file is ready for the Files app handoff.")}><FolderOpen />Open a file</button>}
        </header>

        <div className="editor-tabs" role="tablist" aria-label="Open documents">
          {openDocuments.map((document) => {
            const Icon = FILE_ICONS[document.language];
            const dirty = (contents[document.id] ?? document.content) !== savedContents[document.id];
            return (
              <div className={`editor-tab is-${document.accent}${document.id === activeId ? " is-active" : ""}`} key={document.id}>
                <button type="button" role="tab" aria-selected={document.id === activeId} onClick={() => selectDocument(document)}><Icon /><span>{document.name}</span>{dirty && <i />}</button>
                <button type="button" aria-label={`Close ${document.name}`} onClick={() => closeDocument(document.id)}><X /></button>
              </div>
            );
          })}
          <button type="button" className="editor-tabs__new" aria-label="Create or open a file" onClick={() => onOpenFile ? onOpenFile() : setNotice("Create a file from the Files app.")}><Plus /></button>
        </div>

        {notice && <div className="editor-notice" role="status"><Sparkles /><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice(undefined)}><X /></button></div>}

        <div className={`editor-canvas${activeDocument ? "" : " editor-canvas--empty"}`}>
          {activeDocument ? (
            <>
              <div className="editor-canvas__topline">
                <span className={`is-${activeDocument.accent}`}><i />{languageLabel(activeDocument.language)}</span>
                {activeDocument.language === "markdown" && (
                  <div><button type="button" aria-pressed={viewMode === "source"} onClick={() => setViewMode("source")}>Source</button><button type="button" aria-pressed={viewMode === "preview"} onClick={() => setViewMode("preview")}>Preview</button></div>
                )}
              </div>
              {viewMode === "preview" && activeDocument.language === "markdown" ? (
                <article className="editor-markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{activeContent}</ReactMarkdown></article>
              ) : (
                <CodeCanvas
                  document={activeDocument}
                  value={activeContent}
                  editorRef={editorRef}
                  onChange={(value) => {
                    setContents((current) => ({ ...current, [activeDocument.id]: value }));
                    onChange?.(activeDocument, value);
                  }}
                />
              )}
            </>
          ) : (
            <div className="editor-empty">
              <div className="editor-empty__mark"><FileCode2 /></div>
              <span>Shared text editor</span>
              <strong>Open a file to start editing</strong>
              <p>Choose an existing file or create a new one in Files. Your changes will be available to the whole team.</p>
              <button type="button" onClick={() => onOpenFile ? onOpenFile() : setNotice("Open file is ready for the Files app handoff.")}><FolderOpen />Browse files</button>
              <small>You can also double-click a text file in Files.</small>
            </div>
          )}
        </div>

        <footer className="editor-statusbar">
          <div><FolderOpen />Shared workspace {activeDocument && <><CircleDot />Live file</>}</div>
          <div>{activeDocument ? <><span>{saving ? "Saving" : isDirty ? "Unsaved" : "Saved"}</span><span>Spaces: 2</span><span>UTF-8</span><span>{languageLabel(activeDocument.language)}</span></> : <span>Ready</span>}<Bot />Neura ready</div>
        </footer>
      </main>

      {rightPanelOpen && activeDocument && (
        <aside className="editor-context" aria-label="Editor context">
          <header><div><button type="button" aria-pressed={rightPanel === "outline"} onClick={() => setRightPanel("outline")}>Outline</button><button type="button" aria-pressed={rightPanel === "neura"} onClick={() => setRightPanel("neura")}>Neura</button></div><button type="button" aria-label="Close context panel" onClick={() => setRightPanelOpen(false)}><X /></button></header>
          {rightPanel === "outline" ? (
            <div className="editor-outline">
              <div><span>Symbols in</span><strong>{activeDocument?.name}</strong></div>
              {outline.length ? outline.map((entry) => (
                <button type="button" key={`${entry.line}-${entry.label}`} onClick={() => jumpToLine(entry.line)}>
                  <i className={entry.kind}><Braces /></i><span>{entry.label}</span><small>{entry.line}</small>
                </button>
              )) : <p>No symbols found in this document.</p>}
            </div>
          ) : (
            <div className="editor-neura">
              <div className="editor-neura__heading"><span>N</span><div><strong>Neura</strong><small>Project context synced</small></div></div>
              <p>I’m following this file with the Atlas brief and shared skills in context.</p>
              <section><span>One useful move</span><strong>Extract the plan formatter</strong><p>The formatter can become a shared skill without changing this workflow’s public API.</p><button type="button" onClick={() => setNotice("Neura suggestion is a placeholder interaction.")}><Sparkles />Show the change</button></section>
              <button type="button" className="editor-neura__ask" onClick={() => setNotice("Ask Neura is ready for the shared session API.")}><MessageSquareText />Ask about this file</button>
            </div>
          )}
        </aside>
      )}

      {!rightPanelOpen && activeDocument && <button type="button" className="editor-context-toggle" aria-label="Open context panel" onClick={() => setRightPanelOpen(true)}><PanelRight /></button>}
    </div>
  );
}

function EditorFileButton({ document, active, dirty, onClick, compact = false, depth = 0 }: { document?: EditorDocument; active: boolean; dirty?: boolean; onClick: () => void; compact?: boolean; depth?: number }) {
  if (!document) return null;
  const Icon = FILE_ICONS[document.language];
  return (
    <button type="button" className={`editor-file is-${document.accent}${active ? " is-active" : ""}${compact ? " is-compact" : ""}`} style={{ paddingLeft: `${.62 + depth * .72}rem` }} onClick={onClick}>
      <Icon /><span><strong>{document.name}</strong>{compact && <small>{document.path}</small>}</span>{dirty && <i />}
    </button>
  );
}

function CodeCanvas({ document, value, editorRef, onChange }: { document: EditorDocument; value: string; editorRef: RefObject<HTMLTextAreaElement | null>; onChange: (value: string) => void }) {
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const lines = value.split("\n");
  return (
    <div className={`editor-code is-${document.accent}`}>
      <div className="editor-code__gutter" aria-hidden="true" style={{ transform: `translateY(${-scroll.top}px)` }}>
        {lines.map((_, index) => <span key={index}>{index + 1}</span>)}
      </div>
      <pre aria-hidden="true" style={{ transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }}>
        <code>{lines.map((line, index) => <span className="editor-code__line" key={index}>{highlightLine(line, document.language)}</span>)}</code>
      </pre>
      <textarea
        ref={editorRef}
        aria-label={`Code editor for ${document.name}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => setScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })}
        spellCheck={false}
      />
      <div className="editor-minimap" aria-hidden="true">
        {lines.slice(0, 34).map((line, index) => <i className={line.trim().startsWith("//") ? "is-comment" : ""} key={index} style={{ width: `${Math.min(92, Math.max(12, line.length * 2.1))}%` }} />)}
      </div>
    </div>
  );
}
