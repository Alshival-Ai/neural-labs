import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeClient } from "./nativeClient";
import { configureNativeActor, selectNativeConnection } from "./nativeApi";

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
    expect(JSON.parse(String(options?.body))).toEqual({ operation: "turns.start", selection,
      params: { conversation: "conversation", requestId: "same-request", attachments: [], input: [{ type: "text", text: "Please implement this plan" }] } });
  });
  it("projects durable native history without spawning another turn", async () => {
    configure();
    const events = [
      { id: 1, turn_id: "turn", type: "turn-started", payload: { input: [{ type: "text", text: "Fixture" }] } },
      { id: 2, turn_id: "turn", type: "output", payload: { delta: "Saved.\nMEDIA: reports/plot.png" } },
      { id: 3, turn_id: "turn", type: "turn-completed", payload: { status: "succeeded" } },
    ];
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ events, cursor: 3 }), { status: 200 }));
    const history = await new NativeClient().loadHistory("conversation");
    expect(history[0].text).toBe("Fixture"); expect(history[1].text).toBe("Saved.");
    expect(history[1].attachments?.[0].path).toBe("reports/plot.png");
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).operation).toBe("events.read");
  });
});
