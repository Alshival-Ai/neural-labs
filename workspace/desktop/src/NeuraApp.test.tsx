import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { insertTeamMention, invokesTeamAgent, matchingTeamMentionSuggestions, MessageAttachments, modelProviderErrorMessage, NEURA_FRESH_START_AFTER_MS, neuraWebsitePreviewFile, NeuraApp, staleChatActivityForFreshStart, submitsChatComposerShortcut, TeamTerminalSidebar, teamAgentPhaseFromStatus, teamMentionTriggerAt, teamMessagePresentation } from "./NeuraApp";
import { PLAN_REQUEST, IMPLEMENT_REQUEST } from "./neuraPlanning";
import { writeDeviceState } from "./deviceState";
import { AppViewportProvider } from "./appViewport";
import type { NeuraGateway } from "./openclaw";
import type { TerminalDescriptor } from "./terminalApi";
import type { ConnectionState, GatewayEvent, SessionRow } from "./types";

const session: SessionRow = {
  key: "agent:main:neura:test",
  sessionId: "session-test",
  title: "Realtime test",
  updatedAt: Date.now(),
  archived: false,
  active: false,
  category: "neura",
  visibility: "draft",
  sharingRole: "owner",
};

class FakeGateway {
  readonly calls: string[] = [];
  readonly sends: Array<{ message: string; queueMode: "steer" | "followup" }> = [];
  readonly createdSession: SessionRow = { ...session, key: "agent:main:neura:new", sessionId: "session-new", title: "New conversation" };
  sessionActive = false;
  sessions: SessionRow[] = [session];
  createGate?: Promise<void>;
  historyGates = new Map<string, Promise<void>>();
  private sendSequence = 0;
  private eventListeners = new Set<(event: GatewayEvent) => void>();
  async listQuestions() { return []; }
  private statusListener?: (state: ConnectionState, error?: string) => void;

  onStatus(listener: (state: ConnectionState, error?: string) => void) {
    this.statusListener = listener;
    listener("connected");
    return () => { this.statusListener = undefined; };
  }

  onEvent(listener: (event: GatewayEvent) => void) {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  }

  async listSessions() {
    this.calls.push("sessions.list");
    return this.sessions.map((row) => ({ ...row, active: this.sessionActive || row.active }));
  }

  async protectLegacyPrivateSessions(sessions: SessionRow[]) {
    this.calls.push("sessions.protect-private");
    return sessions;
  }

  async subscribeSession(key: string) {
    this.calls.push(`messages.subscribe:${key}`);
    return { key };
  }

  async unsubscribeSession() {}

  async loadHistory(key: string) {
    this.calls.push(`history:${key}`);
    await this.historyGates.get(key);
    return [];
  }

  async createSession() {
    this.calls.push("sessions.create");
    await this.createGate;
    return this.createdSession;
  }

  async readSkillsStatus() {
    return { agentId: "main", skills: [
      {
        name: "cinematic-interactions",
        skillKey: "cinematic-interactions",
        description: "Build cinematic web interactions.",
        disabled: false,
        eligible: true,
        modelVisible: true,
        userInvocable: true,
      },
      {
        name: "local-business-website-builder",
        skillKey: "local-business-website-builder",
        description: "Build high-quality local business websites.",
        disabled: false,
        eligible: true,
        modelVisible: true,
        userInvocable: true,
      },
      {
        name: "disabled-skill",
        skillKey: "disabled-skill",
        description: "This skill must stay hidden.",
        disabled: true,
        eligible: false,
      },
    ] };
  }

  async send(_session: SessionRow, message: string, _attachments: unknown[], queueMode: "steer" | "followup", _options?: { idempotencyKey?: string; terminalContext?: boolean }) {
    this.sessions = this.sessions.map((row) => row.key === _session.key ? { ...row, active: true } : row);
    this.sends.push({ message, queueMode });
    this.sendSequence += 1;
    return { runId: `sent-${this.sendSequence}` };
  }

  async abort(_sessionKey: string, runId?: string) {
    this.calls.push(`abort:${runId ?? "active"}`);
    return { ok: true };
  }

  emit(event: GatewayEvent) {
    for (const listener of this.eventListeners) listener(event);
  }

  emitStatus(state: ConnectionState, error?: string) {
    this.statusListener?.(state, error);
  }
}

const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

afterEach(cleanup);

describe("Neura realtime conversation", () => {
  it("subscribes a restored mobile conversation after the initial roster arrives", async () => {
    const gateway = new FakeGateway();
    writeDeviceState("restored-mobile-voice", "neura", { selectedKey: session.key });
    render(<AppViewportProvider width={390}><NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} storageNamespace="restored-mobile-voice" /></AppViewportProvider>);
    const input = await screen.findByPlaceholderText("Message Neura…");
    expect(input).toBeEnabled();
    expect(gateway.calls).toContain(`messages.subscribe:${session.key}`);
    expect(screen.getByRole("button", { name: "Start private Neura voice chat" })).toBeEnabled();
    fireEvent.change(input, { target: { value: "Hello" } });
    expect(screen.queryByRole("button", { name: "Start private Neura voice chat" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
    fireEvent.change(input, { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "Start private Neura voice chat" })).toBeEnabled();
  });
  it("opens one searchable mobile history drawer despite a saved open desktop sidebar", async () => {
    const gateway = new FakeGateway();
    gateway.sessions = [session, { ...session, key: "older", sessionId: "older", title: "Earlier planning chat" }, { ...session, key: "archived", sessionId: "archived", title: "Archived notes", archived: true }];
    writeDeviceState("mobile-neura", "neura", { selectedKey: session.key, sidebarOpen: true, showArchived: false });
    const app = render(<AppViewportProvider width={390}><NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} storageNamespace="mobile-neura" /></AppViewportProvider>);
    const toggle = screen.getByRole("button", { name: "Open conversation history" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "Neura conversation history" })).not.toBeInTheDocument();
    toggle.focus(); fireEvent.click(toggle);
    const drawer = screen.getByRole("dialog", { name: "Conversation history" });
    expect(screen.getAllByRole("navigation", { name: "Neura conversation history" })).toHaveLength(1);
    await within(drawer).findByRole("button", { name: /Earlier planning chat/ });
    fireEvent.change(within(drawer).getByRole("searchbox"), { target: { value: "earlier" } });
    expect(within(drawer).queryByRole("button", { name: /Realtime test/ })).not.toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: /Earlier planning chat/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(gateway.calls).toContain("history:older"));
    fireEvent.click(toggle);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(await screen.findByRole("button", { name: /Archived notes/ })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(toggle).toHaveFocus();
    app.rerender(<AppViewportProvider width={1100}><NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} storageNamespace="mobile-neura" /></AppViewportProvider>);
    expect(screen.getByRole("navigation", { name: "Neura conversation history" })).toBeInTheDocument();
  });
  it("uses Shift+Enter for a new line and Enter to send without breaking IME composition", async () => {
    const gateway = new FakeGateway();
    render(<AppViewportProvider width={390}><NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} /></AppViewportProvider>);
    const input = await screen.findByPlaceholderText("Message Neura…");
    fireEvent.change(input, { target: { value: "A multi-line draft" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(gateway.sends).toHaveLength(0);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(gateway.sends).toEqual([
      { message: "A multi-line draft", queueMode: "steer" },
    ]));
  });
  it("opens on the new-chat screen after three hours without chat activity", async () => {
    const gateway = new FakeGateway();
    const oldActivityAt = Date.now() - NEURA_FRESH_START_AFTER_MS;
    gateway.sessions = [{ ...session, updatedAt: oldActivityAt }];
    writeDeviceState("stale-chat-user", "neura.test", {
      selectedKey: session.key,
      sidebarOpen: true,
      terminalSidebarOpen: false,
      showArchived: false,
    });

    const view = render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} active storageNamespace="stale-chat-user" storageArea="neura.test" />);

    expect(await screen.findByText("Work with Neura")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start a conversation" })).toBeInTheDocument();
    expect(gateway.calls).not.toContain(`history:${session.key}`);

    view.rerender(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} active={false} storageNamespace="stale-chat-user" storageArea="neura.test" />);
    view.rerender(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} active storageNamespace="stale-chat-user" storageArea="neura.test" />);
    expect(screen.getByText("Work with Neura")).toBeInTheDocument();
  });

  it("keeps recent and active conversations selected", () => {
    const now = Date.now();
    expect(staleChatActivityForFreshStart([{ ...session, updatedAt: now - NEURA_FRESH_START_AFTER_MS + 1 }], undefined, now)).toBeUndefined();
    expect(staleChatActivityForFreshStart([{ ...session, active: true, updatedAt: now - NEURA_FRESH_START_AFTER_MS }], undefined, now)).toBeUndefined();
    expect(staleChatActivityForFreshStart([{ ...session, updatedAt: now - NEURA_FRESH_START_AFTER_MS }], now - NEURA_FRESH_START_AFTER_MS, now)).toBeUndefined();
  });

  it("directs personal provider failures to Personalization without blaming an administrator", () => {
    expect(modelProviderErrorMessage("401 Unauthorized: Missing bearer or basic authentication in header"))
      .toBe("Neura couldn't activate your ChatGPT connection. Open Personalization and try Resume; reconnect if the problem continues.");
    expect(modelProviderErrorMessage("401 Unauthorized: invalid token"))
      .toBe("Your ChatGPT sign-in was rejected or expired. Reconnect it in Personalization, then try again.");
    expect(modelProviderErrorMessage("The model timed out"))
      .toBe("The model timed out");
  });

  it("uses direct-chat bubbles for the current user's Team Chat messages", () => {
    const currentUser = { id: "user-current", handle: "maya", displayName: "Maya", role: "user" as const };
    const teammate = { id: "user-teammate", handle: "alex", displayName: "Alex", role: "user" as const };

    expect(teamMessagePresentation({ authorKind: "user", author: currentUser }, currentUser.id)).toBe("user");
    expect(teamMessagePresentation({ authorKind: "imported_user", author: currentUser }, currentUser.id)).toBe("user");
    expect(teamMessagePresentation({ authorKind: "user", author: teammate }, currentUser.id)).toBe("teammate");
    expect(teamMessagePresentation({ authorKind: "neura" }, currentUser.id)).toBe("assistant");
    expect(teamMessagePresentation({ authorKind: "system" }, currentUser.id)).toBe("system");
  });

  it("recognizes @Neura and Team Chat skill commands as agent invocations", () => {
    expect(invokesTeamAgent("@Neura help the team")).toBe(true);
    expect(invokesTeamAgent("Could you help, @neura?")).toBe(true);
    expect(invokesTeamAgent("Please use $local-business-website-builder for this")).toBe(true);
    expect(invokesTeamAgent("$neura summarize the voice memo")).toBe(false);
    expect(invokesTeamAgent("$nerua summarize the voice memo")).toBe(false);
    expect(invokesTeamAgent("Use $neura-helper if it is installed")).toBe(true);
    expect(invokesTeamAgent("The total is $100")).toBe(false);
    expect(invokesTeamAgent("email@example.org$skill")).toBe(false);
  });

  it("finds channel-member @ tags and inserts the selected mention", () => {
    const members = [
      { id: "salvador", handle: "salvador", displayName: "Salvador", role: "admin" as const },
      { id: "maya", handle: "maya", displayName: "Maya Chen", role: "user" as const },
    ];
    expect(teamMentionTriggerAt("email@example.org", 17)).toBeNull();
    const trigger = teamMentionTriggerAt("Please ask @sal", 15);
    expect(trigger).toEqual({ start: 11, end: 15, query: "sal" });
    const suggestions = matchingTeamMentionSuggestions(members, trigger);
    expect(suggestions.map((suggestion) => suggestion.handle)).toEqual(["salvador"]);
    expect(insertTeamMention("Please ask @sal", trigger!, suggestions[0]!)).toEqual({
      value: "Please ask @salvador ",
      caret: 21,
    });
    expect(matchingTeamMentionSuggestions(members, teamMentionTriggerAt("@", 1)).map((suggestion) => suggestion.handle))
      .toEqual(["Neura", "maya", "salvador"]);
  });

  it("shares the Enter send shortcut between private and Team Chat composers", () => {
    expect(submitsChatComposerShortcut({ key: "Enter", shiftKey: false })).toBe(true);
    expect(submitsChatComposerShortcut({ key: "Enter", shiftKey: true })).toBe(false);
    expect(submitsChatComposerShortcut({ key: "Tab", shiftKey: false })).toBe(false);
  });

  it("maps durable Team Chat run states to visible loader phases", () => {
    expect(teamAgentPhaseFromStatus("queued")).toBe("starting");
    expect(teamAgentPhaseFromStatus("running")).toBe("working");
    expect(teamAgentPhaseFromStatus("completed")).toBeUndefined();
    expect(teamAgentPhaseFromStatus("failed")).toBeUndefined();
  });

  it("shows a focused loader until a newly created OpenClaw conversation is ready", async () => {
    const gateway = new FakeGateway();
    let releaseCreate: () => void = () => {};
    let releaseHistory: () => void = () => {};
    gateway.createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
    gateway.historyGates.set(gateway.createdSession.key, new Promise<void>((resolve) => { releaseHistory = resolve; }));
    const view = render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText("Message Neura…")).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    const loader = await screen.findByRole("status", { name: "Preparing Neura conversation" });
    expect(loader).toHaveTextContent("Starting a new chat");
    expect(view.container.querySelector(".neura-ready-orb")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Message Neura…")).not.toBeInTheDocument();

    await act(async () => releaseCreate());
    await waitFor(() => expect(screen.getByRole("status", { name: "Preparing Neura conversation" })).toHaveTextContent("Getting Neura ready"));
    expect(screen.getByRole("status", { name: "Preparing Neura conversation" })).toHaveTextContent("Opening live connection");

    await act(async () => releaseHistory());
    await waitFor(() => expect(screen.getByPlaceholderText("Message Neura…")).toBeEnabled());
    expect(screen.queryByRole("status", { name: "Preparing Neura conversation" })).not.toBeInTheDocument();
    expect(screen.getByText("What should we work on?")).toBeInTheDocument();
  });

  it("makes Team Chat creation a labeled, discoverable action", async () => {
    const gateway = new FakeGateway();
    render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);

    const actions = screen.getAllByRole("button", { name: "New Team Chat" });
    expect(actions.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(actions[0]);
    expect(await screen.findByRole("dialog", { name: "Create Team Chat" })).toBeInTheDocument();
    expect(screen.getByText("Invited teammates")).toBeInTheDocument();
    expect(screen.getByText("Everyone")).toBeInTheDocument();
  });

  it("shows channel terminal activity and connected member bubbles in a collapsible rail", () => {
    const onCreate = vi.fn();
    const onOpen = vi.fn();
    const onExpandedChange = vi.fn();
    const terminal: TerminalDescriptor = {
      id: "terminal-one",
      title: "#release · terminal 1",
      scope: "team",
      shell: "zsh",
      cwd: "~/workspace",
      status: "running",
      createdAt: Date.now() - 60_000,
      lastActivityAt: Date.now() - 5_000,
      cols: 120,
      rows: 34,
      sequence: 4,
      exitCode: null,
      owner: { label: "Maya Chen" },
      owned: true,
      canTerminate: true,
      participants: [
        { id: "maya", label: "Maya Chen", connections: 1 },
        { id: "alex", label: "Alex Rivera", connections: 1 },
      ],
      voiceParticipants: [],
      layoutLeader: null,
      teamChannel: { id: "channel-one", name: "release" },
    };

    const members = [
      { id: "maya", handle: "maya", displayName: "Maya Chen", role: "user" as const },
      { id: "alex", handle: "alex", displayName: "Alex Rivera", role: "user" as const },
    ];
    const view = render(<TeamTerminalSidebar channel={{ id: "channel-one", name: "release", memberCount: 2 }} members={members} sessions={[terminal]} expanded={false} loading={false} creating={false} disabled={false} onExpandedChange={onExpandedChange} onCreate={onCreate} onOpen={onOpen} />);
    expect(screen.getByLabelText("1 active terminal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start a new terminal for #release" }));
    expect(onCreate).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Show terminals for #release" }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);

    view.rerender(<TeamTerminalSidebar channel={{ id: "channel-one", name: "release", memberCount: 2 }} members={members} sessions={[terminal]} expanded loading={false} creating={false} disabled={false} onExpandedChange={onExpandedChange} onCreate={onCreate} onOpen={onOpen} />);
    expect(screen.getByText("Channel terminals")).toBeInTheDocument();
    expect(screen.getByText("Can discover and join")).toBeInTheDocument();
    expect(screen.getByText("2 connected")).toBeInTheDocument();
    expect(screen.getByLabelText("2 connected members")).toHaveTextContent("MCAR");
    fireEvent.click(screen.getByRole("button", { name: "Open terminal #release · terminal 1" }));
    expect(onOpen).toHaveBeenCalledWith(terminal);
  });

  it("subscribes before history and keeps streamed text collapsed until the durable reply", async () => {
    const gateway = new FakeGateway();
    const view = render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);

    await waitFor(() => expect(gateway.calls).toEqual([
      "sessions.list",
      "sessions.protect-private",
      `messages.subscribe:${session.key}`,
      `history:${session.key}`,
    ]));
    expect(await screen.findByPlaceholderText("Message Neura…")).toBeEnabled();

    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key,
      runId: "run-1",
      state: "delta",
      deltaText: "Streaming now",
    } }));
    const timeline = view.container.querySelector(".neura-activity-timeline") as HTMLDetailsElement;
    expect(timeline.open).toBe(false);
    expect(timeline).toHaveTextContent("Streaming now");
    expect(view.container.querySelectorAll("article.message-assistant")).toHaveLength(0);

    act(() => gateway.emit({ event: "session.message", payload: {
      sessionKey: session.key,
      sessionId: session.sessionId,
      runId: "run-1",
      phase: "end",
      messageId: "assistant-1",
      message: { id: "assistant-1", role: "assistant", content: [{ type: "text", text: "The durable answer" }] },
    } }));
    expect(screen.getByText("The durable answer")).toBeInTheDocument();
    expect(screen.queryByText("Streaming now")).not.toBeInTheDocument();

    const listCallsBeforeRosterEvent = gateway.calls.filter((call) => call === "sessions.list").length;
    act(() => gateway.emit({ event: "sessions.changed", payload: {} }));
    await waitFor(() => expect(gateway.calls.filter((call) => call === "sessions.list")).toHaveLength(listCallsBeforeRosterEvent + 1));
    expect(screen.getByPlaceholderText("Message Neura…")).toBeEnabled();
    expect(screen.queryByText("Work with Neura")).not.toBeInTheDocument();
  });

  it("shows WebSocket work steps in a compact expandable transcript timeline", async () => {
    const gateway = new FakeGateway();
    gateway.sessionActive = true;
    const view = render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText("Steer Neura now, or queue what comes next…")).toBeEnabled());

    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key, runId: "activity-run", state: "status", phase: "working",
    } }));
    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key, runId: "activity-run", state: "delta", deltaText: "I’ll inspect the current setup.",
    } }));
    act(() => gateway.emit({ event: "session.tool", payload: {
      sessionKey: session.key,
      runId: "activity-run",
      stream: "tool",
      data: {
        phase: "start",
        name: "exec_command",
        toolCallId: "command-1",
        args: { command: "TOKEN=private-value npm test" },
      },
    } }));
    act(() => gateway.emit({ event: "agent", payload: {
      runId: "activity-run",
      stream: "plan",
      data: { steps: [{ step: "Run the focused tests", status: "in_progress" }] },
    } }));

    const timeline = view.container.querySelector(".neura-activity-timeline") as HTMLDetailsElement;
    expect(timeline).toBeInTheDocument();
    expect(timeline.open).toBe(false);
    expect(within(timeline).getByText("3 steps")).toBeInTheDocument();
    expect(within(timeline).getAllByText("Plan updated")).toHaveLength(2);
    expect(within(timeline).getByText("Running command")).toBeInTheDocument();
    expect(timeline).toHaveTextContent("I’ll inspect the current setup.");
    expect(view.container.querySelectorAll("article.message-assistant")).toHaveLength(0);
    expect(timeline).toHaveTextContent("TOKEN=[redacted] npm test");
    expect(timeline).not.toHaveTextContent("private-value");
    expect(timeline).not.toHaveTextContent("Neura is working through the request");
    expect(timeline).not.toHaveTextContent("workingDone");

    fireEvent.click(within(timeline).getByText("Neura is working"));
    expect(timeline.open).toBe(true);

    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key,
      runId: "activity-run",
      state: "final",
      message: { role: "assistant", content: [{ type: "text", text: "All checks passed." }] },
    } }));
    expect(await screen.findByText("All checks passed.")).toBeInTheDocument();
    expect(screen.getByText("Work details")).toBeInTheDocument();
  });

  it("keeps commentary updates inside Work details and leaves only the final answer in chat", async () => {
    const gateway = new FakeGateway();
    const view = render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText("Message Neura…")).toBeEnabled());

    act(() => gateway.emit({ event: "session.message", payload: {
      sessionKey: session.key,
      runId: "commentary-run",
      phase: "stream",
      messageId: "progress-1",
      message: { id: "progress-1", role: "assistant", phase: "commentary", content: [{ type: "text", text: "I’ll check the deployment notes." }] },
    } }));
    const liveTimeline = view.container.querySelector(".neura-activity-timeline") as HTMLDetailsElement;
    expect(liveTimeline).toBeInTheDocument();
    expect(within(liveTimeline).getAllByText("I’ll check the deployment notes.")).toHaveLength(2);
    expect(within(liveTimeline).getAllByText("Progress update")).toHaveLength(2);
    expect(view.container.querySelectorAll("article.message")).toHaveLength(0);

    act(() => gateway.emit({ event: "session.message", payload: {
      sessionKey: session.key,
      runId: "commentary-run",
      phase: "end",
      messageId: "answer-1",
      message: { id: "answer-1", role: "assistant", phase: "final_answer", content: [{ type: "text", text: "The demo host is ready." }] },
    } }));
    const assistantMessages = view.container.querySelectorAll("article.message-assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toHaveTextContent("The demo host is ready.");
    expect(within(assistantMessages[0] as HTMLElement).getByText("Work details")).toBeInTheDocument();
    expect(within(assistantMessages[0] as HTMLElement).getAllByText("I’ll check the deployment notes.")).toHaveLength(2);
  });

  it.each(["stream", undefined])("quarantines unphased durable progress frames with phase %s while a run is active", async (phase) => {
    const gateway = new FakeGateway();
    gateway.sessionActive = true;
    const view = render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText("Steer Neura now, or queue what comes next…")).toBeEnabled());

    act(() => gateway.emit({ event: "session.message", payload: {
      sessionKey: session.key,
      runId: "legacy-progress-run",
      phase,
      messageId: "progress-legacy-1",
      message: { id: "progress-legacy-1", role: "assistant", content: [{ type: "text", text: "I’ll inspect the private remote history." }] },
    } }));

    expect(view.container.querySelectorAll("article.message-assistant")).toHaveLength(0);
    const timeline = view.container.querySelector(".neura-activity-timeline") as HTMLDetailsElement;
    expect(timeline).toBeInTheDocument();
    expect(timeline.open).toBe(false);
    expect(timeline).toHaveTextContent("I’ll inspect the private remote history.");

    act(() => gateway.emit({ event: "session.message", payload: {
      sessionKey: session.key,
      runId: "legacy-progress-run",
      phase: "end",
      messageId: "answer-legacy-1",
      message: { id: "answer-legacy-1", role: "assistant", content: [{ type: "text", text: "The repository is pushed." }] },
    } }));

    const assistantMessages = view.container.querySelectorAll("article.message-assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toHaveTextContent("The repository is pushed.");
    expect(within(assistantMessages[0] as HTMLElement).getByText("Work details")).toBeInTheDocument();
  });

  it("keeps signed commentary and unclassified deltas collapsed until the final answer", async () => {
    const gateway = new FakeGateway();
    gateway.sessionActive = true;
    const view = render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText("Steer Neura now, or queue what comes next…")).toBeEnabled());

    act(() => gateway.emit({ event: "session.message", payload: {
      sessionKey: session.key,
      runId: "signed-run",
      phase: "stream",
      messageId: "commentary-1",
      message: { id: "commentary-1", role: "assistant", content: [{
        type: "text",
        text: "I’ll inspect the source.",
        textSignature: JSON.stringify({ v: 1, id: "commentary-1", phase: "commentary" }),
      }] },
    } }));
    expect(view.container.querySelectorAll("article.message-assistant")).toHaveLength(0);
    const timeline = view.container.querySelector(".neura-activity-timeline") as HTMLDetailsElement;
    expect(timeline.open).toBe(false);
    expect(timeline).toHaveTextContent("I’ll inspect the source.");

    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key,
      runId: "signed-run",
      state: "delta",
      deltaText: "The source now streams",
    } }));
    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key,
      runId: "signed-run",
      state: "delta",
      deltaText: " the final answer.",
    } }));

    expect(view.container.querySelectorAll("article.message-assistant")).toHaveLength(0);
    expect(timeline).toHaveTextContent("The source now streams the final answer.");
    expect(timeline.open).toBe(false);

    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key,
      runId: "signed-run",
      state: "final",
      message: { role: "assistant", content: [
        { type: "text", text: "I’ll inspect the source.", phase: "commentary" },
        { type: "text", text: "The source now streams the final answer.", phase: "final_answer" },
      ] },
    } }));
    const answer = screen.getByText("The source now streams the final answer.");
    const article = answer.closest("article") as HTMLElement;
    expect(article).toHaveClass("message-assistant");
    expect(within(article).queryByLabelText("Neura is responding")).not.toBeInTheDocument();
    const workDetails = article.querySelector(".neura-activity-timeline") as HTMLDetailsElement;
    expect(workDetails).toHaveTextContent("I’ll inspect the source.");
    expect(workDetails.open).toBe(false);
    expect(answer.compareDocumentPosition(workDetails) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(["aborted", "error"])("keeps partial progress collapsed when a run is %s", async (state) => {
    const gateway = new FakeGateway();
    const view = render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText("Message Neura…")).toBeEnabled());
    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key, runId: "interrupted-run", state: "delta", deltaText: "I’m checking the setup.",
    } }));
    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key, runId: "interrupted-run", state,
    } }));
    const timeline = view.container.querySelector(".neura-activity-timeline") as HTMLDetailsElement;
    expect(timeline.open).toBe(false);
    expect(timeline).toHaveTextContent("I’m checking the setup.");
    const answerText = [...view.container.querySelectorAll("article.message-assistant .message-body > p")].map((node) => node.textContent).join("\n");
    expect(answerText).not.toContain("I’m checking the setup.");
  });

  it("follows new messages at the bottom but preserves a reader's scroll position", async () => {
    const gateway = new FakeGateway();
    const view = render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText("Message Neura…")).toBeEnabled());
    const transcript = view.container.querySelector(".message-scroll") as HTMLDivElement;
    Object.defineProperty(transcript, "scrollHeight", { configurable: true, value: 1_000 });
    Object.defineProperty(transcript, "clientHeight", { configurable: true, value: 300 });

    transcript.scrollTop = 700;
    fireEvent.scroll(transcript);
    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key, runId: "scroll-run", state: "delta", deltaText: "First update",
    } }));
    await waitFor(() => expect(transcript.scrollTop).toBe(1_000));

    transcript.scrollTop = 180;
    fireEvent.scroll(transcript);
    expect(screen.getByRole("button", { name: "Latest" })).toBeInTheDocument();
    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key, runId: "scroll-run", state: "delta", deltaText: " stays put",
    } }));
    expect(transcript.scrollTop).toBe(180);

    fireEvent.click(screen.getByRole("button", { name: "Latest" }));
    expect(transcript.scrollTop).toBe(1_000);
  });

  it("keeps transcript content and scroll position through a WebSocket reconnect", async () => {
    const gateway = new FakeGateway();
    const view = render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText("Message Neura…")).toBeEnabled());
    act(() => gateway.emit({ event: "session.message", payload: {
      sessionKey: session.key,
      sessionId: session.sessionId,
      messageId: "assistant-before-reconnect",
      message: { id: "assistant-before-reconnect", role: "assistant", content: [{ type: "text", text: "Keep my place" }] },
    } }));

    const transcript = view.container.querySelector(".message-scroll") as HTMLDivElement;
    Object.defineProperty(transcript, "scrollHeight", { configurable: true, value: 1_000 });
    Object.defineProperty(transcript, "clientHeight", { configurable: true, value: 300 });
    transcript.scrollTop = 180;
    fireEvent.scroll(transcript);

    act(() => gateway.emitStatus("disconnected"));
    expect(screen.getByText("Keep my place")).toBeInTheDocument();
    act(() => gateway.emitStatus("connected"));
    await waitFor(() => expect(gateway.calls.filter((call) => call === `history:${session.key}`)).toHaveLength(2));
    expect(screen.getByText("Keep my place")).toBeInTheDocument();
    expect(transcript.scrollTop).toBe(180);
  });

  it("opens the live skill picker when a user types $ and inserts the selected command", async () => {
    const gateway = new FakeGateway();
    render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);

    const composer = await screen.findByPlaceholderText("Message Neura…");
    await waitFor(() => expect(composer).toBeEnabled());
    fireEvent.change(composer, { target: { value: "$local", selectionStart: 6 } });

    expect(await screen.findByRole("option", { name: /local-business-website-builder/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /cinematic-interactions/i })).not.toBeInTheDocument();
    expect(screen.queryByText("disabled-skill")).not.toBeInTheDocument();

    fireEvent.keyDown(composer, { key: "Enter" });
    expect(composer).toHaveValue("$local-business-website-builder ");
    expect(screen.queryByRole("listbox", { name: "Available skills" })).not.toBeInTheDocument();
  });

  it("opens Neura's website links in the desktop Preview app", async () => {
    const gateway = new FakeGateway();
    const onPreviewFile = vi.fn();
    render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} onPreviewFile={onPreviewFile} />);

    await waitFor(() => expect(screen.getByPlaceholderText("Message Neura…")).toBeEnabled());
    act(() => gateway.emit({ event: "session.message", payload: {
      sessionKey: session.key,
      sessionId: session.sessionId,
      messageId: "assistant-preview",
      message: {
        id: "assistant-preview",
        role: "assistant",
        content: [{
          type: "text",
          text: "[Open the website](http://127.0.0.1:4173/)\n\nPage: `tiny-site/index.html`",
        }],
      },
    } }));

    const link = screen.getByRole("button", { name: "Open the website" });
    expect(link).toHaveAttribute("title", "Open in desktop Preview");
    fireEvent.click(link);
    expect(onPreviewFile).toHaveBeenCalledWith({ name: "index.html", path: "tiny-site/index.html", size: 0, mimeType: "text/html" });
    expect(neuraWebsitePreviewFile("https://neural-labs.ai/workspace/preview/aGVsbG8td29ybGQ/index.html", "")).toMatchObject({ path: "hello-world/index.html" });
  });

  it("renders image attachments as previews and other files as download cards", () => {
    const { container } = render(<MessageAttachments attachments={[
      { path: "team-uploads/mockup.png", name: "mockup.png", type: "image/png", size: 2048 },
      { path: "team-uploads/brief.pdf", name: "brief.pdf", type: "application/pdf", size: 4096 },
    ]} />);
    expect(screen.getByRole("img", { name: "mockup.png" })).toHaveAttribute("src", "/workspace/api/files/content?path=team-uploads%2Fmockup.png");
    expect(screen.getByRole("button", { name: "Preview mockup.png" })).toBeInTheDocument();
    expect(screen.queryByText("mockup.png")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^brief\.pdf/i })).toBeInTheDocument();
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it.each(["chat", "session.message", "buffered"])("embeds generated video from a %s reply", async (transport) => {
    const gateway = new FakeGateway();
    const view = render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText("Message Neura…")).toBeEnabled());
    const text = "Generated and verified: 2.042 seconds.\n\nMEDIA:/home/node/workspace/projects/cat-video/cat-windowsill.mp4";
    const message = { role: "assistant", content: [{ type: "text", text }] };
    if (transport === "buffered") act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key, runId: "video-run", state: "delta", deltaText: text,
    } }));
    act(() => gateway.emit({ event: transport === "session.message" ? transport : "chat", payload: {
      sessionKey: session.key, runId: "video-run", state: "final", phase: "end",
      ...(transport !== "buffered" ? { message } : {}),
    } }));
    const video = screen.getByLabelText("Play cat-windowsill.mp4");
    expect(video.tagName).toBe("VIDEO");
    expect(video).toHaveAttribute("src", "/workspace/api/files/content?path=projects%2Fcat-video%2Fcat-windowsill.mp4");
    expect(video).toHaveAttribute("controls");
    expect(screen.getByText("Generated and verified: 2.042 seconds.")).toBeInTheDocument();
    expect(view.container).not.toHaveTextContent("MEDIA:");
    expect(view.container.querySelectorAll("article.message-assistant")).toHaveLength(1);
    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key, runId: "video-run", state: "final",
    } }));
    expect(screen.getByLabelText("Play cat-windowsill.mp4")).toBeInTheDocument();
    expect(screen.getByText("Generated and verified: 2.042 seconds.")).toBeInTheDocument();
  });

  it("shows an attachment-only final reply without requiring a durable message event", async () => {
    const gateway = new FakeGateway();
    render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText("Message Neura…")).toBeEnabled());
    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key, runId: "video-run", state: "final",
      message: { role: "assistant", content: [{ type: "video", path: "/home/node/workspace/clip.mp4", mimeType: "video/mp4" }] },
    } }));
    expect(screen.getByLabelText("Play clip.mp4")).toHaveAttribute("src", "/workspace/api/files/content?path=clip.mp4");
  });

  it("steers the active run even after an intermediate assistant message is persisted", async () => {
    const gateway = new FakeGateway();
    gateway.sessionActive = true;
    render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);

    const composer = await screen.findByPlaceholderText("Steer Neura now, or queue what comes next…");
    await waitFor(() => expect(composer).toBeEnabled());
    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key,
      runId: "active-run",
      state: "delta",
      deltaText: "First part",
    } }));
    act(() => gateway.emit({ event: "session.message", payload: {
      sessionKey: session.key,
      runId: "active-run",
      phase: "stream",
      messageId: "assistant-part",
      message: { id: "assistant-part", role: "assistant", content: [{ type: "text", text: "First durable part" }] },
    } }));

    fireEvent.change(composer, { target: { value: "Focus on the queue behavior" } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
    expect(gateway.sends).toHaveLength(0);
    fireEvent.keyDown(composer, { key: "Enter" });

    await waitFor(() => expect(gateway.sends).toEqual([
      { message: "Focus on the queue behavior", queueMode: "steer" },
    ]));
    expect(screen.getByRole("button", { name: "Start private Neura voice chat" })).toBeInTheDocument();
  });

  it("shows FIFO follow-ups and keeps them queued through the admission acknowledgement", async () => {
    const gateway = new FakeGateway();
    gateway.sessionActive = true;
    render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);

    const composer = await screen.findByPlaceholderText("Steer Neura now, or queue what comes next…");
    await waitFor(() => expect(composer).toBeEnabled());
    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key,
      runId: "active-run",
      state: "status",
      phase: "working",
    } }));

    fireEvent.change(composer, { target: { value: "Run the tests next" } });
    fireEvent.click(screen.getByRole("button", { name: "Queue after this run" }));
    await waitFor(() => expect(gateway.sends).toEqual([
      { message: "Run the tests next", queueMode: "followup" },
    ]));
    fireEvent.change(composer, { target: { value: "Then rebuild the workspace" } });
    fireEvent.click(screen.getByRole("button", { name: "Queue after this run" }));
    await waitFor(() => expect(gateway.sends).toEqual([
      { message: "Run the tests next", queueMode: "followup" },
      { message: "Then rebuild the workspace", queueMode: "followup" },
    ]));
    expect(screen.getByRole("region", { name: "Queued messages" })).toHaveTextContent("2 queued");
    expect(screen.getByRole("region", { name: "Queued messages" })).toHaveTextContent("Run the tests next");
    expect(screen.getByRole("region", { name: "Queued messages" })).toHaveTextContent("Then rebuild the workspace");
    expect(screen.getByText("Sends automatically, in order, when the current run finishes.")).toBeInTheDocument();

    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key,
      runId: "sent-1",
      state: "final",
    } }));
    expect(screen.getByRole("region", { name: "Queued messages" })).toHaveTextContent("Run the tests next");
    expect(screen.getByRole("button", { name: "Start private Neura voice chat" })).toBeInTheDocument();

    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key,
      runId: "sent-1",
      state: "status",
      phase: "starting",
    } }));
    expect(screen.getByRole("region", { name: "Queued messages" })).toHaveTextContent("1 queued");
    expect(screen.getByRole("region", { name: "Queued messages" })).not.toHaveTextContent("Run the tests next");
    expect(screen.getByRole("region", { name: "Queued messages" })).toHaveTextContent("Then rebuild the workspace");
    expect(screen.getByText("Run the tests next")).toBeInTheDocument();

    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key,
      runId: "sent-2",
      state: "status",
      phase: "starting",
    } }));
    expect(screen.queryByRole("region", { name: "Queued messages" })).not.toBeInTheDocument();
    expect(screen.getByText("Then rebuild the workspace")).toBeInTheDocument();
  });

  it("recognizes a run that was already active when Neura opens", async () => {
    const gateway = new FakeGateway();
    gateway.sessionActive = true;
    render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);

    const composer = await screen.findByPlaceholderText("Steer Neura now, or queue what comes next…");
    await waitFor(() => expect(composer).toBeEnabled());
    expect(screen.getByText("Neura is working")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop Neura" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start private Neura voice chat" })).toBeInTheDocument();
  });

  it("removes an admitted follow-up from the Gateway queue", async () => {
    const gateway = new FakeGateway();
    gateway.sessionActive = true;
    render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);

    const composer = await screen.findByPlaceholderText("Steer Neura now, or queue what comes next…");
    await waitFor(() => expect(composer).toBeEnabled());
    fireEvent.change(composer, { target: { value: "Skip this if plans change" } });
    fireEvent.click(screen.getByRole("button", { name: "Queue after this run" }));
    const remove = await screen.findByRole("button", { name: "Remove queued message 1" });
    await waitFor(() => expect(remove).toBeEnabled());
    fireEvent.click(remove);

    await waitFor(() => expect(gateway.calls).toContain("abort:sent-1"));
    expect(screen.queryByRole("region", { name: "Queued messages" })).not.toBeInTheDocument();
  });
  it.each(["ctrlKey", "metaKey"])("queues with %s+Enter and preserves Shift+Enter", async (modifier) => {
    const gateway = new FakeGateway();
    gateway.sessionActive = true;
    render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);
    const input = await screen.findByPlaceholderText("Steer Neura now, or queue what comes next…");
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "Next task" } });
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true, [modifier]: true });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, [modifier]: true });
    expect(gateway.sends).toHaveLength(0);
    fireEvent.keyDown(input, { key: "Enter", [modifier]: true });
    await waitFor(() => expect(gateway.sends).toEqual([{ message: "Next task", queueMode: "followup" }]));
  });

  it("drafts plans through ordinary messages and locks selection during a run", async () => {
    const gateway = new FakeGateway();
    render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);
    const input = await screen.findByPlaceholderText("Message Neura…");
    const mode = await screen.findByRole("combobox", { name: "Conversation mode" });
    await waitFor(() => expect(mode).toBeEnabled());
    fireEvent.keyDown(input, { key: "P", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(mode).toHaveValue("plan"));
    expect(screen.getByText("Requests a plan; tool permissions stay the same.")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "Explore the feature" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mode).toBeDisabled());
    fireEvent.keyDown(input, { key: "P", metaKey: true, shiftKey: true });
    expect(gateway.sends).toEqual([{ message: PLAN_REQUEST + "Explore the feature", queueMode: "steer" }]);
    expect(mode).toHaveValue("plan");
  });

  it("locks drafting selection for a server-restored queue", async () => {
    const gateway = new FakeGateway();
    gateway.sessions = [{ ...session, queuedRunCount: 1 }];
    render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);
    const mode = await screen.findByRole("combobox", { name: "Conversation mode" });
    expect(mode).toHaveValue("default");
    expect(mode).toBeDisabled();
  });

  it("implements a durable plan once while preserving the unsent draft", async () => {
    const gateway = new FakeGateway();
    render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);
    const input = await screen.findByPlaceholderText("Message Neura…");
    await waitFor(() => expect(input).toBeEnabled());
    act(() => {
      gateway.emit({ event: "session.message", payload: {
        sessionKey: session.key, messageId: "request-1", message: { id: "request-1", role: "user", content: [{ type: "text", text: PLAN_REQUEST + "Explore the feature" }] },
      } });
      gateway.emit({ event: "session.message", payload: {
        sessionKey: session.key, messageId: "plan-1", message: { id: "plan-1", role: "assistant", content: [{ type: "text", text: "Build the feature" }] },
      } });
    });
    fireEvent.change(input, { target: { value: "Keep this draft" } });
    const button = await screen.findByRole("button", { name: "Implement plan" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(gateway.sends).toEqual([{ message: IMPLEMENT_REQUEST + "Build the feature", queueMode: "steer" }]));
    expect(input).toHaveValue("Keep this draft");
    expect(screen.getByRole("combobox", { name: "Conversation mode" })).toHaveValue("default");
  });

  it("does not resurrect a run that completes before the implementation acknowledgement", async () => {
    const gateway = new FakeGateway();
    let acknowledge!: (value: { runId: string }) => void;
    vi.spyOn(gateway, "send").mockImplementation(() => new Promise((resolve) => { acknowledge = resolve; }));
    render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Conversation mode" })).toBeEnabled());
    act(() => gateway.emit({ event: "session.message", payload: {
      sessionKey: session.key, messageId: "plan-race", message: { id: "plan-race", role: "assistant", content: [{ type: "text", text: "A quick plan", textSignature: JSON.stringify({ v: 1, phase: "final_answer", proposedPlan: true }) }] },
    } }));
    fireEvent.click(await screen.findByRole("button", { name: "Implement plan" }));
    gateway.sessions = [{ ...session, active: false }];
    act(() => gateway.emit({ event: "chat", payload: { sessionKey: session.key, runId: "fast-run", state: "final" } }));
    await act(async () => acknowledge({ runId: "fast-run" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Conversation mode" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Stop Neura" })).not.toBeInTheDocument();
  });

  it("keeps drafting selection local without a session protocol extension", async () => {
    const gateway = new FakeGateway();
    const view = render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);
    const mode = await screen.findByRole("combobox", { name: "Conversation mode" });
    await waitFor(() => expect(mode).toBeEnabled());
    fireEvent.change(mode, { target: { value: "plan" } });
    expect(mode).toHaveValue("plan");
    expect(gateway.sends).toEqual([]);
    view.unmount();
    render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);
    expect(await screen.findByRole("combobox", { name: "Conversation mode" })).toHaveValue("default");
  });

});

it("automatically requests recent terminal context without a selector", async () => {
  const gateway = new FakeGateway();
  const send = vi.spyOn(gateway, "send");
  writeDeviceState("terminal-context-user", "neura", { selectedKey: session.key });
  render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} storageNamespace="terminal-context-user" />);
  await waitFor(() => expect(gateway.calls).toContain(`history:${session.key}`));
  expect(screen.queryByRole("combobox", { name: "Terminal context" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove terminal context" })).not.toBeInTheDocument();
  const composer = screen.getByPlaceholderText("Message Neura…");
  await waitFor(() => expect(composer).toBeEnabled());
  fireEvent.change(composer, { target: { value: "Why did this fail?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(send).toHaveBeenCalledWith(expect.anything(), "Why did this fail?", [], "steer", { terminalContext: true }));
});
