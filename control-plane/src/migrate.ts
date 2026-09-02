import { loadConfig } from "./config.js";
import { Database } from "./database.js";
import { createPool } from "./pool.js";

const config = await loadConfig();
const database = new Database(createPool(config));
try {
  await database.migrate();
  console.log("Control-plane database migrations are current");
} finally {
  await database.close();
}
