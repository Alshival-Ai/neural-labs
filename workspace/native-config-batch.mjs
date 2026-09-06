import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// The pinned OpenClaw release's batch CLI can retain provider plugin handles
// after a successful write. Run its own validated/CAS mutation implementation
// in a bounded child, and exit only after that implementation returns.
export const isNativeConfigBundle = (name) => /^config-cli-[\w-]{8}\.js$/u.test(name);

export async function applyNativeConfigBatch(operations, load = async () => {
  const files = (await readdir("/app/dist")).filter(isNativeConfigBundle);
  if (files.length !== 1) throw new Error("Native configuration adapter is unavailable");
  return import(pathToFileURL(`/app/dist/${files[0]}`).href);
}) {
  if (!Array.isArray(operations) || operations.length !== 2) throw new Error("Invalid model configuration batch");
  const { runConfigSet } = await load();
  if (typeof runConfigSet !== "function") throw new Error("Native configuration adapter is unavailable");
  let failed = false;
  await runConfigSet({
    cliOptions: { batchJson: JSON.stringify(operations) },
    runtime: {
      log: () => {},
      error: () => { failed = true; },
      exit: (code) => { if (code !== 0) { failed = true; throw new Error("Native configuration update failed"); } },
    },
  });
  if (failed) throw new Error("Native configuration update failed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await applyNativeConfigBatch(JSON.parse(process.argv[2]));
    process.exit(0);
  } catch {
    // Native output/configuration can include credential references: never echo it.
    process.stderr.write("Native model configuration could not be applied\n", () => process.exit(1));
  }
}
