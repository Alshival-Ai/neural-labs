// Called with protected stdin, never key-bearing argv. Use OpenClaw's public SDK.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire("/app/package.json");
try {
  let input = "";
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 8192) throw new Error(); }
  const { agentDir, profileId, key } = JSON.parse(input);
  if (typeof key !== "string" || !key.trim() || key.length > 4096 || !/^anthropic:neural-labs-(main|nl-teamneura)$/.test(profileId)) throw new Error();
  const { upsertAuthProfileWithLockOrThrow } = await import(pathToFileURL(require.resolve("openclaw/plugin-sdk/provider-auth-api-key")).href);
  await upsertAuthProfileWithLockOrThrow({ agentDir, profileId, credential: { type: "api_key", provider: "anthropic", key } });
  process.exit(0);
} catch { process.stderr.write("Claude API key could not be saved\n"); process.exit(1); }
