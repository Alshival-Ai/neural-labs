import { Pool } from "pg";

import type { ControlPlaneConfig } from "./config.js";

export function createPool(config: ControlPlaneConfig): Pool {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.database,
    user: config.database.user,
    password: config.database.password,
    ssl: config.database.ssl ? { rejectUnauthorized: true } : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", (error) => {
    // node-postgres emits idle-client failures on the pool. Handling the event
    // lets health checks report the outage while Docker/PostgreSQL reconnects.
    console.error("Idle PostgreSQL connection failed", error.message);
  });
  return pool;
}
