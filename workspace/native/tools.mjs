import { randomBytes } from "node:crypto";

const READ_TOOLS = new Set(["google_places_search", "google_place_details", "google_place_photo",
  "google_geocode_address", "google_reverse_geocode", "search_gif", "pexels_search_photos",
  "read_project_graph", "pexels_search_videos", "get_automation_notification_context", "list_terminals", "read_terminal"]);

// One MCP application per live execution capability. Connector keys stay in
// this trusted service; provider processes receive only a revocable turn token.
export class NativeTools {
  constructor({ origin, teamOrigin, createApplication, configuration, request = fetch, browser, projectRead }) {
    this.projectRead = projectRead; this.browser = browser; this.origin = new URL(origin); this.createApplication = createApplication;
    this.teamOrigin = teamOrigin; this.configuration = configuration; this.request = request; this.sessions = new Map();
  }
  async mint(grant, context) {
    let browserSession, browserQueue = Promise.resolve();
    const browserCall = this.browser && context ? input => {
      const result = browserQueue.then(async () => {
        await grant.revalidate();
        if (!active) throw new Error('Execution ended');
        browserSession ||= await this.browser.acquire(grant, context);
        return browserSession.call(input);
      });
      browserQueue = result.catch(() => {}); return result;
    } : undefined;
    await grant.revalidate();
    const token = randomBytes(32).toString("base64url");
    let active = true;
    const transport = async (url, init) => {
      await grant.revalidate();
      if (!active) throw new Error("Execution ended");
      const target = new URL(url);
      if (target.pathname === "/internal/notifications/send" && grant.deliveryEnabled?.() === false)
        throw new Error("External notification delivery is disabled");
      if (target.pathname.startsWith("/internal/notifications/") && grant.jobId) {
        const body = JSON.parse(init?.body || "{}");
        if (body.automationId !== grant.jobId || body.runId && body.runId !== grant.occurrenceId)
          throw new Error("Notification target does not match the active automation");
      }
      return this.request(url, init);
    };
    const authorizeTool = async (name, input) => {
      await grant.revalidate();
      if (!active) throw new Error("Execution ended");
      if (grant.policy?.sandbox === "read-only" && !READ_TOOLS.has(name) && name !== "browser" && !(name === "deployments" && ["hosting","list","status","logs"].includes(input?.action))) throw new Error("The saved execution policy does not allow this tool");
    };
    const application = this.createApplication(this.configuration, transport, undefined, authorizeTool, browserCall,
      this.deployments ? input => this.deployments.call(input, { ...grant, revalidate: async () => {
        await grant.revalidate(); if (!active) throw new Error('Execution ended');
      } }) : undefined, this.projectRead ? async input => {
        await grant.revalidate(); if (!active) throw new Error('Execution ended');
        const result = await this.projectRead(grant.actor, input);
        await grant.revalidate(); if (!active) throw new Error('Execution ended');
        return result;
      } : undefined);
    const entry = { application, grant, revoke: () => { active = false; } }; this.sessions.set(token, entry);
    const url = new URL("/mcp", this.origin).href, headers = { Authorization: `Bearer ${token}` };
    const team = grant.team && this.teamOrigin ? { url: new URL("/team-mcp", this.origin).href, http_headers: headers } : undefined;
    return {
      mediatedBrowser: Boolean(browserCall),
      codex: { url, http_headers: headers, ...(team ? { team } : {}) },
      claude: { mcpServers: { "neural-labs": { type: "http", url, headers },
        ...(team ? { "neural-labs-team": { type: "http", url: team.url, headers } } : {}) } },
      release: async () => { active = false; this.sessions.delete(token); await browserSession?.release(); await application.close(); },
    };
  }
  async handle(request, response) {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    const session = typeof token === "string" ? this.sessions.get(token) : undefined;
    if (!session || !["/mcp", "/team-mcp"].includes(request.url)) { response.writeHead(401, { "Cache-Control": "no-store" }).end(); return; }
    try {
      await session.grant.revalidate();
      if (this.sessions.get(token) !== session) throw new Error("Execution ended");
      if (request.url === "/team-mcp") {
        if (!session.grant.team || !this.teamOrigin || request.method !== "POST") throw new Error("Team Chat tool unavailable");
        const chunks = []; let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 1024 * 1024) throw new Error("Team Chat tool request exceeds limit");
          chunks.push(chunk);
        }
        await session.grant.revalidate();
        const upstream = await this.request(new URL("/internal/team-mcp", this.teamOrigin), {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(65000),
          headers: { Authorization: `Bearer ${session.grant.team.capability}`, "Content-Type": "application/json" },
          body: Buffer.concat(chunks),
        });
        const responseChunks = []; let total = 0;
        if (!upstream.body) throw new Error("Team Chat tool response is empty");
        for await (const chunk of upstream.body) {
          total += chunk.length;
          if (total > 4 * 1024 * 1024) throw new Error("Team Chat tool response exceeds limit");
          responseChunks.push(chunk);
        }
        const body = Buffer.concat(responseChunks);
        await session.grant.revalidate();
        response.writeHead(upstream.status, { "Cache-Control": "no-store", "Content-Type": upstream.headers.get("content-type") || "application/json" }).end(body);
        return;
      }
      // The MCP application is not the account/session authority. Consume the
      // scoped bearer here and do not forward it to provider HTTP transports.
      delete request.headers.authorization;
      session.application.app(request, response);
    } catch { if (!response.headersSent) response.writeHead(403, { "Cache-Control": "no-store" }).end(); else response.destroy(); }
  }
  async close() {
    const entries = [...this.sessions.values()]; this.sessions.clear();
    for (const row of entries) row.revoke();
    await Promise.all(entries.map(row => row.application.close()));
    await this.browser?.close();
  }
}
