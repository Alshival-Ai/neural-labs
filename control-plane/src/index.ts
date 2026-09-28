import { attachProjectSocket } from "./projectSocket.js";
import { ProjectStore } from "./projects.js";
import { SessionService } from "./sessions.js";
import { bindAuthenticationMode, reconcileManagedMembers } from "./managed.js";
import { UpdateService } from "./updates.js";
import { createServer } from "node:http";

import { loadConfig } from "./config.js";
import { CollaborationStore } from "./collaboration.js";
import { CollaborationSocketHub } from "./collaborationSocket.js";
import { Database } from "./database.js";
import { createPool } from "./pool.js";
import { createApplication } from "./server.js";
import { TeamAgentProcessor } from "./teamAgent.js";
import { ModelProviderPolicies } from "./modelProviders.js";

const config = await loadConfig();
const database = new Database(createPool(config));
await database.migrate();
await bindAuthenticationMode(database, config);

if (config.managed) {
  // Managed mode never runs standalone administrator bootstrap.
  await database.pool.query(`UPDATE instance_config SET setup_complete=true, public_origin=$1,
    local_auth_enabled=false, microsoft_auth_enabled=false, microsoft_mcp_enabled=false WHERE singleton_id=1`,
  [config.publicOrigin!.origin]);
} else if (config.autoSetup) {
  const stored = await database.getInstanceConfig();
  if (!stored.setupComplete) {
    await database.saveSetup({
      publicOrigin: config.publicOrigin!.origin,
      ...config.setupDefaults,
      ...(config.environmentEntra
        ? {
            entraTenantId: config.environmentEntra.tenantId,
            entraClientId: config.environmentEntra.clientId,
            entraAuthorityHost: config.environmentEntra.authorityHost,
          }
        : {}),
    });
    await database.audit(null, "instance.environment_setup_completed", null, {
      localAuthEnabled: config.setupDefaults.localAuthEnabled,
      microsoftAuthEnabled: config.setupDefaults.microsoftAuthEnabled,
      microsoftMcpEnabled: config.setupDefaults.microsoftMcpEnabled,
      initialAdminRestricted: true,
    });
  }
}

if (process.argv[2] === "setup-reset") {
  const reset = await database.resetSetupIfUnclaimed();
  console.log(reset ? "Unclaimed setup has been reopened" : "Setup cannot be reopened after a user exists");
  await database.close();
  process.exitCode = reset ? 0 : 1;
} else {
  const updates = new UpdateService(database.pool, config.updates?.codexAutomatic ?? false);
  await updates.initialize();
  const maintenance = async () => (await updates.maintenance()).maintenance;
  const collaboration = new CollaborationStore(database.pool);
  const modelPolicies = new ModelProviderPolicies(database.pool, config.workspace);
  const reconcileModels = () => {
    updates.activeRequests++;
    void maintenance().then(paused => paused ? undefined : modelPolicies.reconcile())
      .catch(() => console.warn("Model defaults reconciliation is unavailable")).finally(() => { updates.activeRequests--; });
  };
  const modelPolicyTimer = setInterval(reconcileModels, 3_600_000);
  modelPolicyTimer.unref();
  // The workspace may still be booting when the control plane becomes ready.
  // Retry initial imports without waiting for the hourly catalog refresh.
  const modelPolicyStartupTimers = [20_000, 60_000, 180_000].map((delay) => {
    const timer = setTimeout(reconcileModels, delay);
    timer.unref();
    return timer;
  });
  reconcileModels();
  let agentProcessor: TeamAgentProcessor | undefined;
  const socketHub = new CollaborationSocketHub(collaboration, (run) => agentProcessor?.enqueue(run), maintenance, delta => { updates.activeRequests += delta; });
  const application = createApplication({
    database,
    updates,
    config,
    collaboration,
    modelPolicies,
    onCollaborationEvent: (event) => { void socketHub.publish(event); },
    onAgentRun: (run) => agentProcessor?.enqueue(run),
    onAgentCancel: id => agentProcessor?.cancel(id),
  });
  agentProcessor = new TeamAgentProcessor(
    collaboration,
    config,
    (event) => socketHub.publish(event),
  );
  let reconcilingMembers = false;
  const reconcileMembers = async () => {
    if (reconcilingMembers || !config.managed) return;
    reconcilingMembers = true;
    try { await reconcileManagedMembers(database, config); }
    catch { console.warn("Managed membership reconciliation is pending"); }
    finally { reconcilingMembers = false; }
  };
  const memberTimer = setInterval(() => { void reconcileMembers(); }, 15000);
  memberTimer.unref();
  void reconcileMembers();
  const notificationTimer = setInterval(() => { void maintenance().then(paused => paused ? undefined : application.notifications.tick()).catch(() => console.warn("Notification reconciliation is unavailable")); }, 15_000);
  notificationTimer.unref();
  const server = createServer(application.app);
  socketHub.attach(server);
  const projectSocket = attachProjectSocket(server, new SessionService(database, config), new ProjectStore(database.pool));
  server.listen(config.port, config.host, () => {
    console.log(`Neural Labs control plane listening on ${config.host}:${config.port}`);
  });

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    clearInterval(modelPolicyTimer);
    clearInterval(notificationTimer);
    clearInterval(memberTimer);
    modelPolicyStartupTimers.forEach(clearTimeout);
    console.log(`Received ${signal}; shutting down control plane`);
    // Upgrade connections are not counted as ordinary HTTP requests, so close
    // them before waiting for the HTTP server to drain.
    socketHub.close();
    projectSocket.close();
    server.close(async (error) => {
      if (error) {
        console.error("HTTP shutdown failed", error);
        process.exitCode = 1;
      }
      await database.close();
    });
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}
