import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NEURAL_TERMINAL_THEME, TerminalApp, isTerminalCopyShortcut, isTerminalInsertToggle, isTerminalPasteShortcut } from "./TerminalApp";
import { writeDeviceState } from "./deviceState";
import type { TerminalDescriptor } from "./terminalApi";

const xtermMocks = vi.hoisted(() => ({ instances: [] as Array<{
  emitData: (data: string) => void;
  emitKey: (event: Partial<KeyboardEvent>) => void;
  focus: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  options: { disableStdin: boolean; fontSize: number };
  styleNonce: string | null;
}> }));

vi.mock("@xterm/xterm", () => ({ Terminal: class {
  cols = 100;
  rows = 30;
  dataHandler: ((data: string) => void) | undefined;
  keyHandler: ((event: KeyboardEvent) => boolean) | undefined;
  options = { disableStdin: false, fontSize: 15 };
  loadAddon = vi.fn();
  open = vi.fn();
  attachCustomKeyEventHandler = vi.fn((handler: (event: KeyboardEvent) => boolean) => { this.keyHandler = handler; });
  onData = vi.fn((handler: (data: string) => void) => { this.dataHandler = handler; return { dispose: vi.fn() }; });
  emitData = (data: string) => this.dataHandler?.(data);
  emitKey = (event: Partial<KeyboardEvent>) => this.keyHandler?.({ type: "keydown", key: "", code: "", ctrlKey: false, metaKey: false, shiftKey: false, ...event } as KeyboardEvent);
  reset = vi.fn();
  write = vi.fn();
  resize = vi.fn();
  focus = vi.fn();
  getSelection = vi.fn(() => "");
  paste = vi.fn();
  clear = vi.fn();
  dispose = vi.fn();
  styleNonce: string | null;
  constructor(options?: { documentOverride?: Document }) {
    this.styleNonce = options?.documentOverride?.createElement("style").getAttribute("nonce") ?? null;
    xtermMocks.instances.push(this);
  }
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit = vi.fn(); } }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class { findNext = vi.fn(); findPrevious = vi.fn(); clearDecorations = vi.fn(); } }));

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.CONNECTING;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = MockWebSocket.CLOSED; });
  constructor() { MockWebSocket.instances.push(this); }
}

const personal = descriptor({ id: "personal-1", title: "workspace", scope: "personal", owned: true, canTerminate: true });
const team = descriptor({
  id: "team-1",
  title: "Release room",
  scope: "team",
  owned: false,
  canTerminate: false,
  participants: [{ id: "ada", label: "ada", connections: 1 }, { id: "salvador", label: "salvador", connections: 2 }],
  controller: { id: "ada", label: "ada", connectionId: "ada-connection" },
});
let created = 1;
let unavailableTicketIds = new Set<string>();

function descriptor(overrides: Partial<TerminalDescriptor>): TerminalDescriptor {
  return {
    id: "terminal-1",
    title: "shell 1",
    scope: "personal",
    shell: "bash",
    cwd: "~/workspace",
    status: "running",
    createdAt: 1,
    lastActivityAt: 1,
    cols: 100,
    rows: 30,
    sequence: 0,
    exitCode: null,
    owner: { label: "ada" },
    owned: true,
    canTerminate: true,
    participants: [],
    controller: null,
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  created = 1;
  unavailableTicketIds = new Set();
  MockWebSocket.instances = [];
  xtermMocks.instances = [];
  document.head.querySelector('meta[name="csp-nonce"]')?.remove();
  const nonce = document.createElement("meta");
  nonce.name = "csp-nonce";
  nonce.content = "terminal-test-nonce";
  document.head.append(nonce);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/workspace/api/terminals" && (!init?.method || init.method === "GET")) return json({ sessions: [personal, team] });
    if (url === "/workspace/api/terminals" && init?.method === "POST") {
      const request = JSON.parse(String(init.body)) as { scope: "personal" | "team"; title?: string };
      created += 1;
      return json({ session: descriptor({ id: `created-${created}`, scope: request.scope, title: request.title || (request.scope === "team" ? "Team shell 2" : `shell ${created}`) }) });
    }
    if (url.endsWith("/ticket")) {
      const terminalId = url.split("/").at(-2) ?? "";
      if (unavailableTicketIds.has(terminalId)) {
        return json({ error: { code: "terminal_not_found", message: "Terminal session not found" } }, 404);
      }
      return json({ ticket: "one-use", path: "/workspace/api/terminals/socket", protocol: "neural-terminal.v1", expiresAt: Date.now() + 60_000 });
    }
    if (init?.method === "DELETE") return json({ closed: true });
    return json({}, 404);
  }));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  localStorage.clear();
  document.head.querySelector('meta[name="csp-nonce"]')?.remove();
  vi.unstubAllGlobals();
});

describe("Terminal app", () => {
  it("opens on New Terminal with team sessions, then creates personal split terminals", async () => {
    render(<TerminalApp />);
    expect(await screen.findByRole("heading", { name: "New Terminal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Terminal" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Open personal terminal workspace" })).not.toHaveAttribute("aria-current");
    expect(within(screen.getByRole("region", { name: "Team sessions" })).getByRole("button", { name: /Release room/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open team session Release room" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/interactive terminal/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Personal terminal/ }));
    expect(await screen.findByRole("button", { name: "Open personal terminal shell 2" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByRole("button", { name: "Split terminal vertically" }));
    await waitFor(() => expect(screen.getAllByLabelText(/interactive terminal/)).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Split terminal vertically" })).toHaveAttribute("aria-pressed", "true");
  });

  it("leaves a Team Terminal without ending its shared process", async () => {
    render(<TerminalApp />);
    const teamSession = await screen.findByRole("button", { name: "Open team session Release room" });
    fireEvent.click(teamSession);
    fireEvent.click(screen.getByRole("button", { name: "Close Release room pane" }));
    await waitFor(() => expect(screen.queryByLabelText("Release room interactive terminal")).not.toBeInTheDocument());
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("team-1"), expect.objectContaining({ method: "DELETE" }));

    fireEvent.click(screen.getByRole("button", { name: "Open team session Release room" }));
    expect(await screen.findByLabelText("Release room interactive terminal")).toBeInTheDocument();
  });

  it("creates a named shared Team Terminal", async () => {
    render(<TerminalApp />);
    fireEvent.click(await screen.findByRole("button", { name: "+ Team" }));
    const composer = screen.getByRole("form", { name: "Create a team terminal" });
    fireEvent.change(within(composer).getByLabelText("Team terminal name"), { target: { value: "Incident room" } });
    fireEvent.click(within(composer).getByRole("button", { name: "Start Team" }));
    expect(await screen.findByRole("button", { name: "Open team session Incident room" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps team creation on New Terminal and routes the rail shortcut there", async () => {
    render(<TerminalApp />);
    await screen.findByRole("heading", { name: "New Terminal" });
    expect(screen.queryByRole("button", { name: "Team terminals" })).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Create a team terminal" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create team terminal" }));
    expect(screen.getByRole("heading", { name: "New Terminal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Team" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Team terminal name")).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Cancel team terminal creation" }));
    expect(screen.queryByRole("form", { name: "Create a team terminal" })).not.toBeInTheDocument();
  });

  it("previews the people in a team session from its social rail icon", async () => {
    render(<TerminalApp />);
    const sessionButton = await screen.findByRole("button", { name: "Open team session Release room" });

    fireEvent.mouseEnter(sessionButton);
    let preview = screen.getByRole("tooltip");
    expect(within(preview).getByText("ada")).toHaveClass("is-controller");
    expect(within(preview).getByText("salvador")).toBeInTheDocument();
    expect(within(preview).getByText("×2")).toBeInTheDocument();

    fireEvent.mouseLeave(sessionButton);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.focus(sessionButton);
    preview = screen.getByRole("tooltip");
    expect(sessionButton).toHaveAttribute("aria-describedby", preview.id);
  });

  it("starts on New Terminal and restores the saved split when its session is opened", async () => {
    writeDeviceState("user-1", "terminal.window-1", {
      activeId: team.id,
      secondaryId: personal.id,
      splitDirection: "horizontal",
      activePane: "secondary",
      hiddenTeamIds: [],
      textScale: 1.6,
    });
    render(<TerminalApp storageNamespace="user-1" storageArea="terminal.window-1" />);

    const teamSession = await screen.findByRole("button", { name: "Open team session Release room" });
    expect(screen.getByRole("button", { name: "New Terminal" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(teamSession);
    expect(teamSession).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Split terminal horizontally" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByLabelText(/interactive terminal/)).toHaveLength(2);
    await waitFor(() => expect(xtermMocks.instances.every((terminal) => terminal.options.fontSize === 18)).toBe(true));
  });

  it("sends keystrokes and renders output through the terminal WebSocket", async () => {
    render(<TerminalApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Open personal terminal workspace" }));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    const terminal = xtermMocks.instances[0];
    expect(terminal.styleNonce).toBe("terminal-test-nonce");
    socket.readyState = MockWebSocket.OPEN;
    socket.onmessage?.({ data: JSON.stringify({ type: "ready", mode: "replay", connectionId: "connection-1", session: personal }) });

    terminal.emitData("pwd\r");
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: "pwd\r" }));

    socket.onmessage?.({ data: JSON.stringify({ type: "output", sequence: 1, data: "/home/node/workspace\r\n" }) });
    expect(terminal.write).toHaveBeenCalledWith("/home/node/workspace\r\n");
    await waitFor(() => expect(terminal.focus).toHaveBeenCalled());
  });

  it("uses the shared desktop font size for terminal chrome and xterm", async () => {
    const onFontScaleChange = vi.fn();
    const view = render(<TerminalApp fontScale={100} onFontScaleChange={onFontScaleChange} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open personal terminal workspace" }));
    expect(await screen.findByRole("button", { name: "Reset font size to 100%" })).toHaveTextContent("100%");
    const terminal = xtermMocks.instances[0];
    expect(terminal.options.fontSize).toBe(18);

    fireEvent.click(screen.getByRole("button", { name: "Increase font size" }));
    expect(onFontScaleChange).toHaveBeenCalledWith(110);
    view.rerender(<TerminalApp fontScale={110} onFontScaleChange={onFontScaleChange} />);
    expect(screen.getByRole("button", { name: "Reset font size to 100%" })).toHaveTextContent("110%");
    expect(screen.getByLabelText("Developer terminal")).not.toHaveClass("terminal-text-scale-110");
    await waitFor(() => expect(terminal.options.fontSize).toBe(20));
  });

  it("keeps a Team Terminal visible while another participant drives it", async () => {
    render(<TerminalApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Open team session Release room" }));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    const terminal = xtermMocks.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    const shared = descriptor({
      ...team,
      participants: [{ id: "ada", label: "ada", connections: 1 }, { id: "salvador", label: "salvador", connections: 1 }],
      controller: { id: "salvador", label: "salvador", connectionId: "salvador-connection" },
    });
    socket.onmessage?.({ data: JSON.stringify({ type: "ready", mode: "replay", connectionId: "ada-connection", viewer: { id: "ada", label: "ada" }, session: shared }) });
    socket.onmessage?.({ data: JSON.stringify({ type: "replay", sequence: 1, data: "salvador@workspace:~ % " }) });

    expect(screen.getByLabelText("Release room interactive terminal")).toBeInTheDocument();
    expect(await screen.findByText("salvador is driving")).toBeInTheDocument();
    expect(terminal.options.disableStdin).toBe(true);
    terminal.emitData("blocked");
    expect(socket.send).not.toHaveBeenCalledWith(JSON.stringify({ type: "input", data: "blocked" }));

    fireEvent.click(screen.getByRole("button", { name: "Take control of Release room" }));
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "claim-control" }));
    socket.onmessage?.({ data: JSON.stringify({ type: "presence", participants: shared.participants, controller: { id: "ada", label: "ada", connectionId: "ada-connection" } }) });
    expect(await screen.findByText("Your turn")).toBeInTheDocument();
    terminal.emitData("pwd\r");
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: "pwd\r" }));
  });

  it("broadcasts team reactions as brief, oversized terminal overlays", async () => {
    render(<TerminalApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Open team session Release room" }));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.onmessage?.({ data: JSON.stringify({ type: "ready", mode: "replay", connectionId: "ada-connection", viewer: { id: "ada", label: "ada" }, session: team }) });

    fireEvent.click(screen.getByRole("button", { name: "Send a team reaction" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Send 🚀" }));
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "reaction", emoji: "🚀" }));

    vi.useFakeTimers();
    act(() => socket.onmessage?.({ data: JSON.stringify({ type: "reaction", id: "reaction-1", emoji: "🚀", actor: { id: "salvador", label: "salvador" } }) }));
    const reaction = screen.getByLabelText("salvador reacted with 🚀");
    expect(reaction).toHaveClass("terminal-pane__reaction");
    expect(reaction.querySelector("b")).toHaveTextContent("🚀");

    act(() => vi.advanceTimersByTime(1800));
    expect(screen.queryByLabelText("salvador reacted with 🚀")).not.toBeInTheDocument();
  });

  it("opens a fresh WebSocket when switching away from an exited shell", async () => {
    render(<TerminalApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Open personal terminal workspace" }));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const firstSocket = MockWebSocket.instances[0];
    firstSocket.readyState = MockWebSocket.OPEN;
    firstSocket.onmessage?.({ data: JSON.stringify({ type: "ready", mode: "replay", connectionId: "connection-1", session: personal }) });
    firstSocket.onmessage?.({ data: JSON.stringify({ type: "exit", exitCode: 0 }) });

    fireEvent.click(screen.getByRole("button", { name: "Open team session Release room" }));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
  });

  it("replaces a terminal session lost during a workspace restart", async () => {
    unavailableTicketIds.add(personal.id);
    render(<TerminalApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Open personal terminal workspace" }));

    expect(await screen.findByText("The workspace terminal restarted in a fresh shell.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open personal terminal workspace" })).toHaveAttribute("aria-current", "page");
    expect(fetch).toHaveBeenCalledWith(
      "/workspace/api/terminals",
      expect.objectContaining({ method: "POST" }),
    );
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
  });

  it("does not create a shell until the user chooses one", async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => json({ sessions: [] }));
    render(<TerminalApp />);

    expect(await screen.findByRole("heading", { name: "New Terminal" })).toBeInTheDocument();
    expect(screen.getByText("No live team sessions")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith(
      "/workspace/api/terminals",
      expect.objectContaining({ method: "POST" }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Personal terminal/ }));
    expect(await screen.findByRole("button", { name: "Open personal terminal shell 2" })).toHaveAttribute("aria-current", "page");
  });
});

describe("terminal clipboard shortcuts", () => {
  const key = (value: Partial<KeyboardEvent>) => ({ key: "", code: "", ctrlKey: false, metaKey: false, shiftKey: false, ...value });

  it("keeps Ctrl+C for SIGINT while supporting developer copy conventions", () => {
    expect(isTerminalCopyShortcut(key({ key: "c", ctrlKey: true }))).toBe(false);
    expect(isTerminalCopyShortcut(key({ key: "C", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isTerminalCopyShortcut(key({ key: "c", metaKey: true }))).toBe(true);
    expect(isTerminalCopyShortcut(key({ code: "Insert", ctrlKey: true }))).toBe(true);
  });

  it("supports platform and insert-key paste conventions", () => {
    expect(isTerminalPasteShortcut(key({ key: "V", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isTerminalPasteShortcut(key({ key: "v", metaKey: true }))).toBe(true);
    expect(isTerminalPasteShortcut(key({ code: "Insert", shiftKey: true }))).toBe(true);
  });

  it("uses an unmodified Insert key for Insert/Overwrite mode", () => {
    expect(isTerminalInsertToggle(key({ code: "Insert" }))).toBe(true);
    expect(isTerminalInsertToggle(key({ code: "Insert", ctrlKey: true }))).toBe(false);
    expect(isTerminalInsertToggle(key({ code: "Insert", shiftKey: true }))).toBe(false);
  });
});

describe("Neural Spectrum terminal profile", () => {
  it("keeps every ANSI color readable against the dark canvas", () => {
    expect(NEURAL_TERMINAL_THEME.foreground).toBe("#f1f3f7");
    expect(NEURAL_TERMINAL_THEME.black).not.toBe(NEURAL_TERMINAL_THEME.background);
    expect(NEURAL_TERMINAL_THEME.blue).not.toBe(NEURAL_TERMINAL_THEME.background);
    expect(NEURAL_TERMINAL_THEME.selectionForeground).toBe("#ffffff");
  });
});
