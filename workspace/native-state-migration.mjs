import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Run before the Gateway or provider reconciliation starts. Deployment operators
// retain original volumes; the public doctor owns native schema migrations.
export async function migrateNativeState({ root, version, run }) {
  const receipt = path.join(root, "native-state-release.json");
  let previous;
  try { previous = JSON.parse(await readFile(receipt, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw new Error("Native migration receipt is unreadable"); }
  if (previous?.version === version) return false;
  let result;
  try { result = await run(["doctor", "--fix", "--non-interactive"], { quiet: true }); }
  catch { throw new Error("Native OpenClaw state migration failed; keep the workspace gated for recovery"); }
  if (result?.status !== 0) throw new Error("Native OpenClaw state migration failed; keep the workspace gated for recovery");
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(receipt + ".pending", JSON.stringify({ version }), { mode: 0o600 });
  await rename(receipt + ".pending", receipt);
  return true;
}
