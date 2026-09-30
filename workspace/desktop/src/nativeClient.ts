export * from "./neuraMessages";
import { createWorkspaceFolder, uploadWorkspaceFile } from "./filesApi";
import { projectGeneratedMedia } from "./neuraMedia";
import { nativeRequest, nativeSelection, type NativeEvent } from "./nativeApi";
import { settingsRequest } from "./settingsApi";
import { terminalMessageContext } from "./terminalAgentApi";
import type { ComposerAttachment, ConnectionState, GatewayEvent, NeuraAttachment, NeuraMessage, SessionRow } from "./types";
import type { NeuraQuestion } from "./neuraMessages";
import { mapAutomationsSnapshot, type AutomationsSnapshot } from "./automationsApi";

type Subscription = { key: string; sessionKey: string; controller: AbortController; cursor: number; refs: number; artifacts: Map<string, NeuraAttachment[]>; output: Map<string, string> };
export class NativeClient {
  private status: ConnectionState = "disconnected";
  private error?: string;
  private statuses = new Set<(state: ConnectionState, error?: string) => void>();
  private listeners = new Set<(event: GatewayEvent) => void>();
  private subscriptions = new Map<string, Subscription>();
  private activeTurns = new Map<string, string>();
  private questions = new Map<string, NeuraQuestion>();
  private started = false;
  private uploads = new Map<string, Promise<Array<{ path: string; name: string; type: string; size: number }>>>();
  private selectionChanged = () => { this.stopStreams(); if (this.started) void this.connect(); };
  private emit(event: GatewayEvent) { for (const listener of this.listeners) listener(event); }
  private setStatus(state: ConnectionState, error?: string) {
    this.status = state; this.error = error; for (const listener of this.statuses) listener(state, error);
  }
  setAgentId(_agentId: string) { /* Actor identity is asserted by the control plane. */ }
  start() {
    if (this.started) return; this.started = true;
    window.addEventListener("neural-labs-native-selection", this.selectionChanged); void this.connect();
  }
  private async connect() {
    this.setStatus("connecting");
    try { await this.listSessions(); if (this.started) this.setStatus("connected"); }
    catch (error) { if (this.started) this.setStatus("error", error instanceof Error ? error.message : "Native runtime unavailable"); }
  }
  private stopStreams() { for (const sub of this.subscriptions.values()) sub.controller.abort(); this.subscriptions.clear(); this.questions.clear(); }
  stop() { this.started = false; window.removeEventListener("neural-labs-native-selection", this.selectionChanged); this.stopStreams(); this.setStatus("disconnected"); }
  onStatus(listener: (state: ConnectionState, error?: string) => void) { this.statuses.add(listener); listener(this.status, this.error); return () => this.statuses.delete(listener); }
  onEvent(listener: (event: GatewayEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async listSessions() { return (await nativeRequest<{ sessions: SessionRow[] }>("conversations.list")).sessions; }
  async createSession() { return (await nativeRequest<{ session: SessionRow }>("conversations.create")).session; }
  async protectLegacyPrivateSessions(sessions: SessionRow[]) { return sessions; }
  async subscribeSession(sessionKey: string): Promise<Subscription> {
    let sub = this.subscriptions.get(sessionKey);
    if (sub) { sub.refs++; return sub; }
    sub = { key: sessionKey, sessionKey, controller: new AbortController(), cursor: 0, refs: 1, artifacts: new Map(), output: new Map() };
    this.subscriptions.set(sessionKey, sub); void this.stream(sub); return sub;
  }
  async unsubscribeSession(sub: Subscription) {
    if (--sub.refs > 0) return;
    sub.controller.abort(); if (this.subscriptions.get(sub.sessionKey) === sub) this.subscriptions.delete(sub.sessionKey);
  }
  private async stream(sub: Subscription) {
    const selection = nativeSelection(); let backoff = 500;
    while (!sub.controller.signal.aborted) {
      try {
        const result = await nativeRequest<{ events: NativeEvent[]; cursor: number }>("events.read",
          { conversation: sub.sessionKey, after: sub.cursor, waitMs: 15000 }, selection, sub.controller.signal);
        if (sub.controller.signal.aborted) return;
        for (const event of result.events) { this.project(sub, event); sub.cursor = event.id; }
        backoff = 500; this.setStatus("connected");
      } catch (error) {
        if (sub.controller.signal.aborted) return;
        this.setStatus("disconnected", error instanceof Error ? error.message : "Reconnecting to the native runtime");
        await new Promise<void>(resolve => {
          const finish = () => { clearTimeout(timer); sub.controller.signal.removeEventListener("abort", finish); resolve(); };
          const timer = setTimeout(finish, backoff); sub.controller.signal.addEventListener("abort", finish, { once: true });
        });
        backoff = Math.min(10000, backoff * 2);
      }
    }
  }
  private project(sub: Subscription, event: NativeEvent) {
    const runId = event.turn_id, sessionKey = sub.sessionKey, data = event.payload;
    if (event.type === "turn-started") {
      this.activeTurns.set(sessionKey, runId);
      this.emit({ event: "chat", payload: { sessionKey, runId, state: "status" } });
    } else if (event.type === "output") {
      const delta = String(data.delta ?? data.text ?? "");
      sub.output.set(runId, (sub.output.get(runId) || "") + delta);
      this.emit({ event: "chat", payload: { sessionKey, runId, state: "delta", deltaText: delta } });
    } else if (event.type === "artifact-created") {
      sub.artifacts.set(runId, [...(sub.artifacts.get(runId) || []), data.attachment as NeuraAttachment]);
      this.emit({ event: "session.message", payload: { sessionKey, runId, phase: "update", messageId: `native:${runId}`,
        message: { role: "assistant", content: [{ type: "text", text: sub.output.get(runId) || "" }], attachments: (sub.artifacts.get(runId) || []).map(item => ({ ...item, mimeType: item.type })) } } });
    } else if (event.type === "approval-required") {
      const request = data.request as { method: string; params: Record<string, unknown> };
      if (request.method === "item/tool/requestUserInput") {
        const questions = request.params.questions as Array<{ id: string; header: string; question: string; options?: Array<{ label: string; description?: string }>; isSecret?: boolean }>;
        this.questions.set(String(data.id), { id: String(data.id), sessionKey, expiresAtMs: Date.now() + 20 * 60_000,
          questions: questions.map(row => ({ questionId: row.id, header: row.header, question: row.question, options: row.options || [], multiSelect: false, isOther: true, isSecret: row.isSecret === true })) });
        this.emit({ event: "question.requested", payload: { sessionKey } });
      } else {
        this.emit({ event: "session.approval", payload: { sessionKey, id: data.id, kind: "exec", presentation: {
          title: "Approve this action?", detail: JSON.stringify(request.params), allowedDecisions: ["allow-once", "deny"] } } });
      }
    } else if (event.type === "turn-completed") {
      this.activeTurns.delete(sessionKey);
      for (const [id, question] of this.questions) if (question.sessionKey === sessionKey) this.questions.delete(id);
      const failed = !["succeeded", "cancelled"].includes(String(data.status));
      this.emit({ event: "session.message", payload: { sessionKey, runId, phase: failed ? "error" : "end", messageId: `native:${runId}`,
        message: { role: "assistant", phase: "final_answer", attachments: (sub.artifacts.get(runId) || []).map(item => ({ ...item, mimeType: item.type })), content: [{ type: "text", text: sub.output.get(runId) || (failed ? `Turn ${data.status}.` : "") }] } } });
      this.emit({ event: "chat", payload: { sessionKey, runId, state: failed ? "error" : "final", errorMessage: failed ? `Turn ${data.status}` : undefined } });
      sub.output.delete(runId); sub.artifacts.delete(runId);
    } else if (["item-started", "item-completed", "tool-output", "plan", "diff"].includes(event.type)) {
      const item = (data.item || data) as Record<string, unknown>;
      this.emit({ event: "session.tool", payload: { sessionKey, runId, stream: event.type === "plan" ? "plan" : "tool",
        data: { ...item, toolCallId: item.id || data.itemId || `event:${event.id}`, name: item.type || item.tool_name || "native tool", status: event.type === "item-completed" ? "completed" : "running", args: { command: item.command }, output: data.delta || item.aggregatedOutput } } });
    }
  }
  async loadHistory(sessionKey: string, _options: { hideUnfinishedTail?: boolean } = {}): Promise<NeuraMessage[]> {
    const rows: NativeEvent[] = []; let cursor = 0;
    for (;;) {
      const result = await nativeRequest<{ events: NativeEvent[]; cursor: number }>("events.read", { conversation: sessionKey, after: cursor });
      rows.push(...result.events); cursor = result.cursor;
      if (result.events.length < 1000) break;
    }
    const messages: NeuraMessage[] = [], outputs = new Map<string, string>(), artifacts = new Map<string, NeuraAttachment[]>();
    for (const event of rows) {
      if (event.type === "turn-started") messages.push({ id: `user:${event.turn_id}`, role: "user", attachments: event.payload.attachments as NeuraMessage["attachments"],
        text: (event.payload.input as Array<{ text: string }>).map(row => row.text).join("\n") });
      if (event.type === "artifact-created") artifacts.set(event.turn_id, [...(artifacts.get(event.turn_id) || []), event.payload.attachment as NeuraAttachment]);
      if (event.type === "output") outputs.set(event.turn_id, (outputs.get(event.turn_id) || "") + String(event.payload.delta ?? event.payload.text ?? ""));
      if (event.type === "turn-completed") messages.push({ id: `native:${event.turn_id}`, role: "assistant", ...projectGeneratedMedia(outputs.get(event.turn_id) || `Turn ${event.payload.status}.`, artifacts.get(event.turn_id) || []) });
    }
    return messages;
  }
  async send(session: SessionRow, message: string, attachments: ComposerAttachment[], _queueMode: "steer" | "followup", options: { idempotencyKey?: string; terminalContext?: boolean } = {}) {
    const requestId = options.idempotencyKey || crypto.randomUUID();
    let upload = this.uploads.get(requestId);
    if (!upload && attachments.length) {
      upload = (async () => {
        const directory = (await createWorkspaceFolder("", `chat-attachments-${requestId}`)).item.path;
        return Promise.all(attachments.map(async item => {
          const uploaded = (await uploadWorkspaceFile(directory, item.file)).item;
          return { path: uploaded.path, name: item.file.name, type: item.file.type || "application/octet-stream", size: item.file.size };
        }));
      })();
      this.uploads.set(requestId, upload);
    }
    const uploaded = await upload || [];
    const result = await nativeRequest<{ id: string; accepted: boolean }>("turns.start", { conversation: session.key,
      requestId, attachments: uploaded, input: [{ type: "text", text: message + (options.terminalContext ? await terminalMessageContext(session.key) : "") }] },
      nativeSelection() && { ...nativeSelection()!, model: session.modelOverride || nativeSelection()!.model });
    this.activeTurns.set(session.key, result.id); return { runId: result.id };
  }
  async abort(sessionKey: string, runId?: string) { return nativeRequest("turns.cancel", { turn: runId || this.activeTurns.get(sessionKey) }); }
  async patchSession(session: SessionRow, patch: { label?: string; archived?: boolean; model?: string | null; thinkingLevel?: string | null }) {
    return nativeRequest("conversations.update", { conversation: session.key, patch: { ...(patch.label !== undefined ? { title: patch.label } : {}),
      ...(patch.archived !== undefined ? { archived: patch.archived } : {}), ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.thinkingLevel !== undefined ? { effort: patch.thinkingLevel } : {}) } });
  }
  async deleteSession(session: SessionRow) { return nativeRequest("conversations.delete", { conversation: session.key }); }
  async resolveMessageAttachments(_sessionKey: string, messages: NeuraMessage[]) { return messages; }
  async resolveApproval(id: string, _kind: string, decision: string) {
    if (!["allow-once", "deny"].includes(decision)) throw new Error("Choose an approval for this action only");
    return nativeRequest("approvals.resolve", { approval: id, decision: { decision: decision === "allow-once" ? "accept" : "decline" } });
  }
  async listQuestions(sessionKey: string) { return [...this.questions.values()].filter(row => row.sessionKey === sessionKey); }
  async resolveQuestion(id: string, answers: Record<string, string[]> | null) {
    const result = await nativeRequest("approvals.resolve", { approval: id, decision: answers === null ? { answers: {} } : { answers: Object.fromEntries(Object.entries(answers).map(([key, answers]) => [key, { answers }])) } });
    this.questions.delete(id); this.emit({ event: "question.resolved", payload: { id } }); return result;
  }
  async readSkillsStatus(): Promise<unknown> { return settingsRequest("/workspace/api/skills/library"); }
  async readAutomations(): Promise<AutomationsSnapshot> {
    const result = await settingsRequest<Record<string, unknown>>("/workspace/api/automations"); return mapAutomationsSnapshot(result.status, result, result);
  }
  async searchSkills(query: string): Promise<unknown> { return settingsRequest(`/workspace/api/skills/catalog-search?q=${encodeURIComponent(query)}`); }
  async readSkillDetail(slug: string): Promise<unknown> { return settingsRequest(`/workspace/api/skills/catalog-detail?ref=${encodeURIComponent(slug)}`); }
}
