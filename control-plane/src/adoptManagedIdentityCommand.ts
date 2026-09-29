import { readFile, stat } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { Database } from "./database.js";
import { createPool } from "./pool.js";
import { adoptManagedIdentity, adoptionSchema } from "./adoptManagedIdentity.js";
import { portalExchange } from "./managed.js";
import { z } from "zod";

const [mappingPath, flag, ...rest] = process.argv.slice(2);
if (!mappingPath || ![undefined, "--confirm"].includes(flag) || rest.length)
  throw new Error("Usage: node dist/adoptManagedIdentityCommand.js PRIVATE_MAPPING_JSON [--confirm]");
const info = await stat(mappingPath);
if (!info.isFile() || info.mode & 0o077) throw new Error("Mapping must be a private file (0600)");
const mapping = adoptionSchema.parse(JSON.parse(await readFile(mappingPath, "utf8")));
const config = await loadConfig();
if (!config.managed) throw new Error("Configure the target managed authority before adoption");
const members = z.object({ members: z.array(z.object({ subject: z.string(), role: z.enum(["admin", "user"]) })),
  generation: z.number().int().positive() }).parse(await portalExchange(config, "members", {
  subjects: mapping.users.map(row => row.subject),
}));
if (mapping.users.some(row => !members.members.some(member => member.subject === row.subject)))
  throw new Error("Every mapped subject must currently belong to the target portal workspace");
const database = new Database(createPool(config));
try {
  console.log(JSON.stringify(await adoptManagedIdentity(database, config.managed, mapping, flag === "--confirm")));
} finally { await database.close(); }
