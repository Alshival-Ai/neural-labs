// The API key arrives on protected stdin, never in process arguments or logs.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire("/app/package.json");

try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 8192) throw new Error();
  }
  const { agentDir, profileId, key } = JSON.parse(input);
  if (
    typeof agentDir !== "string" ||
    typeof key !== "string" || !key.trim() || key.length > 4096 ||
    !/^openai:nl-[a-z0-9]+-api$/u.test(profileId)
  ) throw new Error();
  const { upsertAuthProfileWithLockOrThrow } = await import(
    pathToFileURL(require.resolve("openclaw/plugin-sdk/provider-auth-api-key")).href
  );
  await upsertAuthProfileWithLockOrThrow({
    agentDir,
    profileId,
    credential: { type: "api_key", provider: "openai", key: key.trim() },
  });
} catch {
  process.stderr.write("OpenAI API key could not be saved\n");
  process.exitCode = 1;
}
