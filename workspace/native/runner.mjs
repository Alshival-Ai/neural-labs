import { createConnection } from "node:net";
const jobId = process.argv[2], socketPath = process.env.NEURAL_LABS_SCHEDULER_SOCKET;
if (process.argv.length !== 3 || !/^[a-zA-Z0-9_-]{1,200}$/.test(jobId || "") || !socketPath?.startsWith("/")) {
  throw new Error("A native job ID and scheduler socket are required");
}
// Supercronic launches only this fixed runner plus a job ID. The runtime owns
// definitions, prompts, credentials, occurrence identities and durable claims.
const socket = createConnection(socketPath);
let response = "";
socket.setTimeout(10000, () => { process.exitCode = 1; socket.destroy(); });
socket.on("connect", () => socket.write(JSON.stringify({ jobId }) + "\n"));
socket.on("data", chunk => { response += chunk; if (response.length > 4096) { process.exitCode = 1; socket.destroy(); } });
socket.on("error", () => { process.exitCode = 1; });
socket.on("end", () => {
  try { const result = JSON.parse(response); if (result.error || typeof result.accepted !== "boolean") process.exitCode = 1; }
  catch { process.exitCode = 1; }
});
