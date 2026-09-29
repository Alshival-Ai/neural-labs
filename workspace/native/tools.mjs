import { randomBytes } from "node:crypto";

const READ_TOOLS = new Set(["google_places_search", "google_place_details", "google_place_photo",
  "google_geocode_address", "google_reverse_geocode", "search_gif", "pexels_search_photos",
  "pexels_search_videos", "get_automation_notification_context", "list_terminals", "read_terminal"]);

// One MCP application per live execution capability. Connector keys stay in
// this trusted service; provider processes receive only a revocable turn token.
export class NativeTools {
  constructor({ origin, createApplication, configuration, request = fetch }) {
    this.origin = new URL(origin); this.createApplication = createApplication;
    this.configuration = configuration; this.request = request; this.sessions = new Map();
  }
  async mint(grant) {
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
    const authorizeTool = async name => {
      await grant.revalidate();
      if (!active) throw new Error("Execution ended");
      if (grant.policy?.sandbox === "read-only" && !READ_TOOLS.has(name)) throw new Error("The saved execution policy does not allow this tool");
    };
    const application = this.createApplication(this.configuration, transport, undefined, authorizeTool);
    const entry = { application, grant, revoke: () => { active = false; } }; this.sessions.set(token, entry);
    const url = new URL("/mcp", this.origin).href, headers = { Authorization: `Bearer ${token}` };
    return {
      codex: { url, http_headers: headers }, claude: { mcpServers: { "neural-labs": { type: "http", url, headers } } },
      release: async () => { active = false; this.sessions.delete(token); await application.close(); },
    };
  }
  async handle(request, response) {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    const session = typeof token === "string" ? this.sessions.get(token) : undefined;
    if (!session || request.url !== "/mcp") { response.writeHead(401, { "Cache-Control": "no-store" }).end(); return; }
    try {
      await session.grant.revalidate();
      if (this.sessions.get(token) !== session) throw new Error("Execution ended");
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
  }
}
