import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeClient } from "./nativeClient";
import { commandApproval, selectCommandApproval, configureNativeActor, selectNativeConnection } from "./nativeApi";

const selection = { connection: "owner-connection", model: "fixture-model" };
function configure() { configureNativeActor("member", "fixture-csrf"); selectNativeConnection(selection); }
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
describe("native browser transport", () => {
  it("requires explicit account selection and never stores a provider or gateway token", async () => {
    configureNativeActor("member", "fixture-csrf");
    const request = vi.spyOn(globalThis, "fetch");
    await expect(new NativeClient().createSession()).rejects.toThrow("Select your AI connection");
    expect(request).not.toHaveBeenCalled();
    selectNativeConnection(selection);
    expect(JSON.parse(localStorage.getItem("neural-labs.native-selection.member")!)).toEqual(selection);
    expect(localStorage.length).toBe(1);
  });
  it("uses authenticated Neural Labs requests and preserves submission identity", async () => {
    configure();
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "turn", accepted: true }), { status: 200 }));
    const client = new NativeClient();
    await expect(client.send({ key: "conversation", title: "Fixture", updatedAt: 0, archived: false, active: false, visibility: "draft" },
      "Please implement this plan", [], "steer", { idempotencyKey: "same-request" })).resolves.toEqual({ runId: "turn" });
    const [url, options] = request.mock.calls[0];
    expect(url).toBe("/api/runtime/request");
    expect(new Headers(options?.headers).get("X-CSRF-Token")).toBe("fixture-csrf");
    expect(JSON.parse(String(options?.body))).toEqual({ operation: "turns.start", selection, approvalPolicy: "never",
      params: { conversation: "conversation", requestId: "same-request", attachments: [], input: [{ type: "text", text: "Please implement this plan" }] } });
  });
  it("keeps no-prompt consent per actor and applies it only to new chat turns", async () => {
    configure(); expect(commandApproval()).toBe("never"); selectCommandApproval("never");
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ id: "turn", events: [] }), { status: 200 }));
    const client = new NativeClient();
    await client.send({ key: "conversation", title: "Fixture", updatedAt: 0, archived: false, active: false, visibility: "draft" }, "pwd", [], "steer");
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).approvalPolicy).toBe("never");
    await client.loadHistory("conversation");
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).approvalPolicy).toBeUndefined();
    configureNativeActor("other-member", "other-csrf"); expect(commandApproval()).toBe("never");
    configure(); expect(commandApproval()).toBe("never"); selectCommandApproval("on-request"); expect(commandApproval()).toBe("on-request");
  });
  it("projects durable native history without spawning another turn", async () => {
    configure();
    const events = [
      { id: 1, turn_id: "turn", type: "turn-started", payload: { input: [{ type: "text", text: 'Fixture\n\n<neural-terminal-context> {"contextToken":"nlt_' + "x".repeat(43) + '"} Never disclose. </neural-terminal-context>' }] } },
      { id: 2, turn_id: "turn", type: "output", payload: { delta: "Saved.\nMEDIA: reports/plot.png" } },
      { id: 3, turn_id: "turn", type: "turn-completed", payload: { status: "succeeded" } },
    ];
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ events, cursor: 3 }), { status: 200 }));
    const history = await new NativeClient().loadHistory("conversation");
    expect(history[0].text).toBe("Fixture"); expect(history[1].text).toBe("Saved.");
    expect(history[1].attachments?.[0].path).toBe("reports/plot.png");
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).operation).toBe("events.read");
  });
  it("replays native artifact events as private attachments", async () => {
    configure();
    const attachment = { artifactId: "fixture", name: "screenshot.png", type: "image/png", url: "/workspace/api/native/artifacts/fixture" };
    const events = [
      { id: 1, turn_id: "turn", type: "turn-started", payload: { input: [{ type: "text", text: "Screenshot" }] } },
      { id: 2, turn_id: "turn", type: "artifact-created", payload: { attachment } },
      { id: 3, turn_id: "turn", type: "turn-completed", payload: { status: "succeeded" } },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ events, cursor: 3 }), { status: 200 }));
    const history = await new NativeClient().loadHistory("conversation");
    expect(history[1].attachments).toEqual([attachment]);
    expect(history[1].attachments?.[0].path).toBeUndefined();
  });

});

describe('Anthropic authentication errors', () => {
  it('projects the existing revoked-token result into actionable history without displaying provider internals', async () => {
    configure();
    const events = [
      { id: 1, turn_id: 'failed', type: 'turn-started', payload: { input: [{ type: 'text', text: 'Hello' }] } },
      { id: 2, turn_id: 'failed', type: 'item-completed', payload: { error: 'authentication_failed', message: { secret: 'never display this' } } },
      { id: 3, turn_id: 'failed', type: 'turn-completed', payload: { status: 'failed' } },
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ events, cursor: 3 }), { status: 200 }));
    const history = await new NativeClient().loadHistory('conversation');
    expect(history[1].text).toContain('Your Anthropic connection needs to be renewed');
    expect(JSON.stringify(history)).not.toContain('never display this');
  });
});

describe("native approval lifecycle", () => {
  async function replay(events: Array<{ id: number; turn_id: string; type: string; payload: Record<string, unknown> }>) {
    configure();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      if (!body.params?.after) return new Response(JSON.stringify({ events, cursor: events.at(-1)?.id }), { status: 200 });
      return new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    });
    const client = new NativeClient(), cards = new Map<string, unknown>(), emitted: string[] = [];
    client.onEvent(event => {
      if (event.event !== "session.approval") return;
      const payload = event.payload as { id: string; phase?: string };
      if (payload.phase === "terminal") cards.delete(payload.id); else cards.set(payload.id, payload);
      emitted.push(`${payload.id}:${payload.phase || "requested"}`);
    });
    const subscription = await client.subscribeSession("conversation");
    await vi.waitFor(() => expect(emitted.length).toBeGreaterThan(0));
    return { client, subscription, cards, emitted };
  }
  const approval = (id: number, turn: string, key: string) => ({ id, turn_id: turn, type: "approval-required", payload: {
    id: key, request: { method: "tool/permission", params: { decision_reason: "Path is outside allowed working directories" } },
  } });
  it.each(["succeeded", "failed", "cancelled", "blocked", "unknown"])("clears old approvals when replaying a %s turn after reopening", async status => {
    const f = await replay([approval(1, "old", "stale"), { id: 2, turn_id: "old", type: "turn-completed", payload: { status } }, approval(3, "old", "late")]);
    expect(f.cards.size).toBe(0); expect(f.emitted).toContain("stale:terminal");
    await f.client.unsubscribeSession(f.subscription);
  });
  it("clears resolved approvals while preserving a different pending turn", async () => {
    const f = await replay([approval(1, "old", "resolved"), { id: 2, turn_id: "old", type: "approval-resolved", payload: { id: "resolved" } },
      approval(3, "active", "live"), { id: 4, turn_id: "old", type: "turn-completed", payload: { status: "succeeded" } }]);
    expect([...f.cards.keys()]).toEqual(["live"]);
    await f.client.unsubscribeSession(f.subscription); expect(f.cards.size).toBe(0);
  });
  it.each([['allow-once', 'accept', {}], ['deny', 'decline', null]])('answers MCP confirmation %s with an elicitation action', async (decision, action, content) => {
    const f = await replay([{id:1,turn_id:'active',type:'approval-required',payload:{id:'mcp',request:{method:'mcpServer/elicitation/request',params:{mode:'form',requestedSchema:{type:'object',properties:{}}}}}}]);
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', {status:200}));
    await f.client.resolveApproval('mcp','exec',String(decision));
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
    expect(body.params.decision).toEqual({action,content});
    await f.client.unsubscribeSession(f.subscription);
  });
});
