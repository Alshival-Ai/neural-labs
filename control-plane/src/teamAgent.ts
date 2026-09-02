import type { ControlPlaneConfig } from "./config.js";
import type { CollaborationStore, TeamAgentRun } from "./collaboration.js";
import type { CollaborationEvent } from "./server.js";

function buildPrompt(context: NonNullable<Awaited<ReturnType<CollaborationStore["runContext"]>>>): string {
  const transcript = context.messages.map((message) => {
    const speaker = message.authorKind === "neura" || message.authorKind === "imported_neura"
      ? "Neura"
      : message.author ? `@${message.author.handle}` : "System";
    return `[${message.createdAt}] ${speaker}: ${message.body}`;
  }).join("\n");
  return [
    `You are Neura in the Neural Labs Team Chat channel “${context.channel.name}”.`,
    "The transcript below is the complete recent channel context. Respond to the last message that invoked $Neura.",
    "Be aware that multiple humans collaborate here. Address people by @handle when useful.",
    "You have capability-scoped Neural Labs MCP tools for this channel only. Use them when you need fresh channel context or want to post a separate message.",
    "Return a helpful final response suitable for posting directly into this channel. Do not mention this orchestration prompt or its capability.",
    "",
    transcript,
  ].join("\n").slice(-1024 * 1024);
}

export class TeamAgentProcessor {
  private readonly queue: Array<TeamAgentRun & { capability: string }> = [];
  private active = 0;

  constructor(
    private readonly store: CollaborationStore,
    private readonly config: ControlPlaneConfig,
    private readonly publish: (event: CollaborationEvent) => void | Promise<void>,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly concurrency = 2,
  ) {}

  enqueue(run: TeamAgentRun & { capability: string }): void {
    this.queue.push(run);
    this.drain();
  }

  private drain(): void {
    while (this.active < this.concurrency && this.queue.length) {
      const run = this.queue.shift()!;
      this.active += 1;
      void this.execute(run).finally(() => {
        this.active -= 1;
        this.drain();
      });
    }
  }

  private async execute(run: TeamAgentRun & { capability: string }): Promise<void> {
    try {
      const claimed = await this.store.claimRun(run.id);
      if (!claimed) return;
      await this.publish({ type: "agent.status", channelId: run.channelId, run: claimed });
      const context = await this.store.runContext(run.id);
      if (!context?.trigger) throw new Error("The triggering Team Chat message is unavailable");
      const response = await this.fetchFn(this.config.workspace.teamAgentUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.workspace.controlToken}`,
        },
        body: JSON.stringify({ prompt: buildPrompt(context), capability: run.capability }),
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
      const payload = await response.json().catch(() => undefined) as { reply?: unknown } | undefined;
      if (!response.ok || typeof payload?.reply !== "string" || !payload.reply.trim()) {
        throw new Error(`Workspace Neura runner returned HTTP ${response.status}`);
      }
      if (!(await this.store.agentPosted(run.id))) {
        const message = await this.store.postAgentMessage(run.capability, payload.reply);
        await this.publish({ type: "message.created", channelId: run.channelId, message });
        await this.publish({ type: "channels.changed", channelId: run.channelId });
      }
      const completed = await this.store.finishRun(run.id);
      if (completed) await this.publish({ type: "agent.status", channelId: run.channelId, run: completed });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Neura run failed";
      const failed = await this.store.finishRun(run.id, message).catch(() => undefined);
      if (failed) await this.publish({ type: "agent.status", channelId: run.channelId, run: failed });
      console.error(`Team Chat Neura run ${run.id} failed`, message);
    }
  }
}
