import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire("/app/package.json");
try {
  const [agentDir, provider, profileId] = process.argv.slice(2);
  if (!agentDir || provider !== "openai" || profileId !== "paused") throw new Error();
  const { updateAuthProfileStoreWithLock } = await import(pathToFileURL(require.resolve("openclaw/plugin-sdk/provider-auth")).href);
  const updated = await updateAuthProfileStoreWithLock({ agentDir, updater(store) { store.order = { ...store.order, [provider]: [] }; return true; } });
  if (!updated || updated.order?.[provider]?.length !== 0) throw new Error();
  process.exit(0);
} catch { process.stderr.write("Provider access could not be paused\n"); process.exit(1); }
