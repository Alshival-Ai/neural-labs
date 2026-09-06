import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const START = "<!-- neural-labs-terminal-guidance:start -->";
const END = "<!-- neural-labs-terminal-guidance:end -->";
export async function installTerminalGuidance(workspaceRoot, source = new URL("./terminal-guidance.md", import.meta.url)) {
  const guidance = await readFile(source, "utf8");
  const destination = path.join(workspaceRoot, "AGENTS.md");
  const previous = await readFile(destination, "utf8").catch((error) => { if (error.code === "ENOENT") return ""; throw error; });
  const start = previous.indexOf(START);
  const end = previous.indexOf(END, start);
  if (start >= 0 && end < 0) throw new Error("The managed terminal guidance block is incomplete");
  const block = `${START}\n${guidance.trim()}\n${END}`;
  const next = start >= 0 ? previous.slice(0, start) + block + previous.slice(end + END.length) : `${block}\n\n${previous}`;
  if (next !== previous) await writeFile(destination, next, { mode: 0o600 });
}
