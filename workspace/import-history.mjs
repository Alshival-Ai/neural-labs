// Operator-only stdin interface. Never register this as an agent tool.
import { createImportedHistory } from "./imported-history.mjs";
let data = "";
for await (const chunk of process.stdin) {
  data += chunk;
  if (Buffer.byteLength(data) > 16 * 1024 * 1024) throw new Error("Manifest too large");
}
const history = createImportedHistory({ root: process.env.OPENCLAW_WORKSPACE_DIR ?? "/home/node/workspace" });
console.log(JSON.stringify(await history.import(JSON.parse(data))));
