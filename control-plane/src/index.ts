import { createServer } from "node:http";

import { loadConfig } from "./config.js";
import { CollaborationStore } from "./collaboration.js";
import { CollaborationSocketHub } from "./collaborationSocket.js";
import { Database } from "./database.js";
import { createPool } from "./pool.js";
import { createApplication } from "./server.js";
import { TeamAgentProcessor } from "./teamAgent.js";

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
  let agentProcessor: TeamAgentProcessor | undefined;
  const socketHub = new CollaborationSocketHub(collaboration, (run) => agentProcessor?.enqueue(run));
  const application = createApplication({
    database,
    config,
    collaboration,
    onCollaborationEvent: (event) => { void socketHub.publish(event); },
    onAgentRun: (run) => agentProcessor?.enqueue(run),
  });
  agentProcessor = new TeamAgentProcessor(
    collaboration,
    config,
    (event) => socketHub.publish(event),
  );
  const server = createServer(application.app);
  socketHub.attach(server);
  server.listen(config.port, config.host, () => {
    console.log(`Neural Labs control plane listening on ${config.host}:${config.port}`);
  });

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
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
