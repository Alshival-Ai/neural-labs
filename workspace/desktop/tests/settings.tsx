// Synthetic, development-only fixture. No production account or provider requests.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsApp } from "../src/SettingsApp";
import { AppViewportProvider } from "../src/appViewport";
import type { ApiProviderPlugin, PluginCatalog } from "../src/settingsApi";
import type { PhoneStatus } from "../src/PhoneSettings";
import "../src/styles.css";
const admin = new URLSearchParams(location.search).get("admin") !== "0";
const user = { id: "11111111-1111-4111-8111-111111111111", email: "member@example.org", handle: "member", displayName: "Example Member", status: "active" as const, role: admin ? "admin" as const : "user" as const };
let phone: PhoneStatus = { available: true, notificationsEnabled: false, phoneNumber: null, verifiedAt: null, pending: null, resendAt: null };
const mcp = { ready: true, mode: "workspace-local" as const, endpoint: "http://127.0.0.1:8792/mcp", transport: "streamable-http" as const, agentServerName: "neural-labs-tools", agentScope: "shared-workspace" as const, publicAccess: false as const, providers: { googlePlaces: true, googleGeocoding: true, klipy: false, pexels: true }, tools: ["google_places_search", "search_gif", "pexels_search_photos"] };
const plugins: PluginCatalog = { plugins: [
  { id: "neural-labs-tools", name: "Neural Labs Tools", description: "Tools supplied to workspace agents.", type: "mcp", scope: "global", ownership: "system", editable: false, ready: true, mcp },
  { id: "twilio-sms", name: "Twilio SMS/MMS", description: "Text your private Neura and receive requested updates.", type: "channel", scope: "global", ownership: "workspace", editable: admin, ready: true, configured: true, source: "settings", accountSidHint: "AC••••", fromNumber: "+12025550123", webhookUrl: "https://neural-labs.example.org/webhooks/twilio/sms", webhookMethod: "POST", webhookVerified: true, smsCapable: true, mmsCapable: true, revision: 1, appliedRevision: 1, error: null },
  ...(["google-maps", "klipy", "pexels"] as const).map((id): ApiProviderPlugin => ({ id, name: id === "google-maps" ? "Google Maps" : id === "klipy" ? "KLIPY" : "Pexels", description: id === "google-maps" ? "Find places and coordinates." : id === "klipy" ? "GIFs for Neura and Team Terminal reactions." : "Stock photos and videos for your projects.", type: "api-provider", scope: "global", ownership: "workspace", editable: admin, configured: id !== "klipy", ready: id !== "klipy", source: id !== "klipy" ? "environment" : null, applied: true, revision: 1, appliedRevision: 1, deploymentOverride: false, state: id !== "klipy" ? "connected" : "disconnected", capabilities: id === "google-maps" ? ["Places", "Geocoding"] : [id === "klipy" ? "GIF search" : "Photo search"], check: null })),
] };
const mutations: unknown[] = [];
Object.assign(window, { settingsQA: { mutations } });
window.fetch = async (input, init) => {
  const url = String(input); const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (method !== "GET") mutations.push({ url, method, body });
  if (url === "/api/admin/overview") return Response.json({ counts: { pending: 0, active: 2, activeAdmins: 1, inactive: 0 }, authentication: { localEnabled: true, microsoftEnabled: true }, workspace: { status: "ready" }, mcp, recentAudit: [] });
  if (url === "/api/auth/providers") return Response.json({ local: { enabled: true }, microsoft: { enabled: true, available: true } });
  if (url === "/api/account/passkeys") return Response.json({ eligible: true, passkeys: [] });
  if (url.startsWith("/api/account/phone")) {
    if (url.endsWith("/request")) phone = { ...phone, pending: { phoneNumber: body.phoneNumber, challengeId: "qa-challenge", expiresAt: new Date(Date.now() + 600000).toISOString(), attemptsRemaining: 5, deliveryAccepted: true }, resendAt: new Date(Date.now() + 60000).toISOString() };
    if (url.endsWith("/verify")) phone = { ...phone, phoneNumber: phone.pending?.phoneNumber ?? null, verifiedAt: new Date().toISOString(), pending: null };
    if (url.endsWith("/notifications") && method === "PUT") phone = { ...phone, notificationsEnabled: body.enabled };
    return Response.json(phone);
  }
  if (url === "/api/plugins") return Response.json(plugins);
  if (url.startsWith("/api/admin/plugins/providers/")) {
    const id = url.split("/")[5];
    const provider = plugins.plugins.find((entry) => entry.id === id) as ApiProviderPlugin;
    if (method === "PUT") Object.assign(provider, { configured: true, state: "configured", source: "settings", deploymentOverride: true, revision: 2, appliedRevision: 2 });
    if (url.endsWith("/check")) Object.assign(provider, { state: "connected", ready: true, check: { revision: 2, capabilities: provider.capabilities.map((name) => ({ name, ok: true, message: "Connection works" })) } });
    return Response.json(provider);
  }
  return Response.json({ error: { message: "Unsupported fixture request" } }, { status: 404 });
};
function Fixture() {
  const [width, setWidth] = useState(innerWidth);
  useEffect(() => { const resize = () => setWidth(innerWidth); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);
  return <div style={{ height: "100dvh", container: "app-window / inline-size" }}><AppViewportProvider width={width}><SettingsApp administrator={admin} currentUserId={user.id} user={user} csrfToken="qa-csrf" providers={["microsoft"]} initialSection="plugins" /></AppViewportProvider></div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
