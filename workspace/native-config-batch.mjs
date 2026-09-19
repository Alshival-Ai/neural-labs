import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

// Hashed dist filenames and exports are build artifacts, not an integration
// contract. Some official images contain multiple config-cli bundles.
export async function applyNativeConfigBatch(operations, execute = promisify(execFile)) {
  if (!Array.isArray(operations) || ![1, 2, 3].includes(operations.length) || operations.some((op) =>
    !op || typeof op.path !== "string" || !op.path || !Object.hasOwn(op, "value"))) {
    throw new Error("Invalid model configuration batch");
  }
  try {
    await execute("openclaw", ["config", "set", "--batch-json", JSON.stringify(operations)], {
      encoding: "utf8", timeout: 110_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
    });
  } catch {
    // CLI errors can include private stdout/stderr. A timeout is never success,
    // even if the CLI may have completed its write before it stopped responding.
    throw new Error("Native model configuration could not be applied; inspect the current settings before retrying");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await applyNativeConfigBatch(JSON.parse(process.argv[2]));
    process.exit(0);
  } catch {
    process.stderr.write("Native model configuration could not be applied\n", () => process.exit(1));
  }
}
