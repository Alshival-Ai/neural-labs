import { createServer } from "node:http";

import { loadProviderConfig } from "./providerConfig.js";
import { createProviderApplication } from "./providerServer.js";

const host = "127.0.0.1";
const port = Number(process.env.NEURAL_LABS_WORKSPACE_MCP_PORT ?? "8792");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(
    "NEURAL_LABS_WORKSPACE_MCP_PORT must be an integer between 1 and 65535",
  );
}

const application = createProviderApplication(loadProviderConfig());
const server = createServer(application.app);
server.listen(port, host, () => {
  console.log(
    "Neural Labs workspace MCP listening on " + host + ":" + String(port),
  );
});

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log("Workspace MCP received " + signal + "; shutting down");
  await application.close();
  server.close((error) => {
    if (error) {
      console.error("Workspace MCP HTTP shutdown failed", error);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
