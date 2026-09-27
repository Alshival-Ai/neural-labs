import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "neural-labs-alshival",
  name: "Alshival workspace tools",
  description: "Portal-authorized project, document, and resource tools under the explicit workspace background grant.",
  register(api) {
    for (const operation of ["list", "call"] as const) {
      const name = `alshival_${operation}_tool${operation === "list" ? "s" : ""}`;
      api.registerTool((context) => ({
        name,
        description: operation === "list"
          ? "Discover Alshival tools available under this workspace’s authorized background grant. Read the returned schemas before calling tools."
          : "Call a tool discovered with alshival_list_tools. Portal permissions are checked on every call.",
        parameters: operation === "list"
          ? { type: "object", properties: { cursor: { type: "string" } }, additionalProperties: false }
          : { type: "object", properties: { name: { type: "string" }, arguments: { type: "object", additionalProperties: true } }, required: ["name"], additionalProperties: false },
        async execute(_id, params) {
          if (!context.agentId || !/^(main|nl-[a-f0-9]{32})$/.test(context.agentId)) {
            return { content: [{ type: "text", text: "Alshival tools require an authorized workspace agent." }], isError: true };
          }
          try {
            const response = await fetch("http://control-plane:4174/internal/alshival/tools", {
              method: "POST", redirect: "error", signal: AbortSignal.timeout(70000),
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.NEURAL_LABS_WORKSPACE_CONTROL_TOKEN ?? ""}` },
              body: JSON.stringify({ agentId: context.agentId, method: `tools/${operation}`, params }),
            });
            if (!response.ok) throw new Error("Authorization unavailable");
            const result = await response.json();
            return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
          } catch {
            return { content: [{ type: "text", text: "Alshival tools are unavailable. Check the workspace background authorization and API & MCP service access." }], isError: true };
          }
        },
      }), { name });
    }
  },
});
