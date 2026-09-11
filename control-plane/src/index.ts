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

if (config.autoSetup) {
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
  const collaboration = new CollaborationStore(database.pool);
  const modelPolicies = new ModelProviderPolicies(database.pool, config.workspace);
  const reconcileModels = () => void modelPolicies.reconcile().catch(() => console.warn("Model defaults reconciliation is unavailable"));
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
  const socketHub = new CollaborationSocketHub(collaboration, (run) => agentProcessor?.enqueue(run));
  const application = createApplication({
    database,
    config,
    collaboration,
    modelPolicies,
    onCollaborationEvent: (event) => { void socketHub.publish(event); },
    onAgentRun: (run) => agentProcessor?.enqueue(run),
  });
  agentProcessor = new TeamAgentProcessor(
    collaboration,
    config,
    (event) => socketHub.publish(event),
  );
  const notificationTimer = setInterval(() => { void application.notifications.tick().catch(() => console.warn("Notification reconciliation is unavailable")); }, 15_000);
  notificationTimer.unref();
  const server = createServer(application.app);
  socketHub.attach(server);
  server.listen(config.port, config.host, () => {
    console.log(`Neural Labs control plane listening on ${config.host}:${config.port}`);
  });

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    clearInterval(modelPolicyTimer);
    clearInterval(notificationTimer);
    modelPolicyStartupTimers.forEach(clearTimeout);
    console.log(`Received ${signal}; shutting down control plane`);
    // Upgrade connections are not counted as ordinary HTTP requests, so close
    // them before waiting for the HTTP server to drain.
    socketHub.close();
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
