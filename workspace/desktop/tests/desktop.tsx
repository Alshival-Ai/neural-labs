// Synthetic local desktop: real shell/apps, fixture accounts, gateway, PTYs and APIs.
import { createRoot } from "react-dom/client";
import { gateway } from "./mobile";
import { NeuraGateway } from "../src/openclaw";
import { App } from "../src/App";
Object.assign(NeuraGateway.prototype, gateway, { start() {}, setAgentId() {} });
const fetchFixture = window.fetch;
const providerTest = new URLSearchParams(location.search).has("provider");
let providerConnecting = false;
window.fetch = async (input, init) => {
  const url = String(input);
  if (providerTest && url === "/api/account/openai/connect") {
    providerConnecting = true;
    return Response.json({ state: "starting", authenticated: false, modelReady: false, paused: false });
  }
  if (providerTest && url === "/api/account/openai") return Response.json({ state: providerConnecting ? "awaiting_user" : "disconnected", authenticated: false, modelReady: false, paused: true, agentId: "qa", verificationUrl: providerConnecting ? "https://auth.openai.com/codex/device" : null, userCode: providerConnecting ? "TEST-CODE" : null });
  if (url === "/api/session") return Response.json({ authenticated: true, csrfToken: "qa", providers: ["local"], neura: { agentId: "qa" }, user: { id: "qa", handle: "qa", email: "qa@example.org", displayName: "QA", role: "user", status: "active" } });
  if (url === "/api/account/openai") return Response.json({ authenticated: true, paused: false, agentId: "qa" });
  if (url === "/api/workspace") return Response.json({ status: "ready" });
  return fetchFixture(input, init);
};
createRoot(document.getElementById("root")!).render(<App />);
