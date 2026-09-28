import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import type { Database } from "./database.js";
import type { ControlPlaneConfig } from "./config.js";
import { ProjectTransferStore, canonical, transferInput } from "./projectTransfer.js";
import { ProjectError } from "./projects.js";

export function registerProjectTransferRoutes(app: Express, database: Database, config: ControlPlaneConfig) {
  if (!config.managed) return;
  const managed = config.managed;
  const store = new ProjectTransferStore(database.pool);
  app.post("/internal/projects/transfer", async (req, res) => {
    const stamp = req.get("x-project-time") ?? "";
    const supplied = req.get("x-project-signature") ?? "";
    const signed = `${managed.workspace}\n${managed.instance}\n${stamp}\n${canonical(req.body)}`;
    const expected = createHmac("sha256", managed.secret).update(signed).digest("hex");
    if (!/^\d{10}$/.test(stamp) || Math.abs(Date.now() / 1000 - Number(stamp)) > 30
      || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
      res.sendStatus(403); return;
    }
    const parsed = transferInput.safeParse(req.body);
    if (!parsed.success) { res.status(422).json({ error: "invalid_transfer" }); return; }
    try { res.json(await store.execute(parsed.data)); }
    catch (error) { res.status(error instanceof ProjectError ? error.status : 503).json({ error: error instanceof ProjectError ? error.code : "transfer_unavailable" }); }
  });
}
