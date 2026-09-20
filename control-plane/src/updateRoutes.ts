import { timingSafeEqual } from "node:crypto";
import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import type { SessionActor } from "./types.js";
import { UpdateError, UpdateService, updatePolicySchema, workerReportSchema } from "./updates.js";

export function updateTokenMatches(header: string | undefined, token: string | undefined) {
  if (!token || token.length < 32 || !header?.startsWith("Bearer ")) return false;
  const left = Buffer.from(header.slice(7)), right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function registerUpdateRoutes(app: Express, updates: UpdateService, options: {
  admin: (req: Request, res: Response) => Promise<SessionActor | undefined>;
  active: (req: Request, res: Response) => Promise<SessionActor | undefined>;
  csrf: (req: Request, res: Response, actor: SessionActor) => boolean;
  sameOrigin: RequestHandler; workerToken: string | undefined; workspaceToken: string;
}) {
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => async (req, res) => {
    res.set("Cache-Control", "no-store");
    try { await fn(req, res); } catch (error) {
      res.status(error instanceof UpdateError ? error.status : error instanceof z.ZodError ? 422 : 503).json({ error: {
        code: error instanceof UpdateError ? error.code : "updates_unavailable",
        message: error instanceof UpdateError ? error.message : error instanceof z.ZodError ? "Choose valid update settings." : "Update service is unavailable.",
      } });
    }
  };
  app.get("/api/admin/updates", wrap(async (req, res) => { if (await options.admin(req, res)) res.json(await updates.status()); }));
  app.put("/api/admin/updates", options.sameOrigin, wrap(async (req, res) => {
    const actor = await options.admin(req, res); if (!actor || !options.csrf(req, res, actor)) return;
    const input = z.object({ revision: z.number().int().min(0), policy: updatePolicySchema }).strict().parse(req.body);
    res.json(await updates.save(input.revision, input.policy, actor.user.id));
  }));
  for (const action of ["check", "install"] as const) app.post(`/api/admin/updates/${action}`, options.sameOrigin, wrap(async (req, res) => {
    const actor = await options.admin(req, res); if (!actor || !options.csrf(req, res, actor)) return;
    z.object({}).strict().parse(req.body ?? {});
    res.status(202).json(await updates.enqueue(action, actor.user.id));
  }));
  app.get("/api/updates/maintenance", wrap(async (req, res) => { if (await options.active(req, res)) res.json(await updates.maintenance()); }));
  app.get("/internal/updates/worker", wrap(async (req, res) => {
    if (!updateTokenMatches(req.headers.authorization, options.workerToken)) { res.sendStatus(401); return; }
    res.json(await updates.workerState());
  }));
  app.post("/internal/updates/worker", wrap(async (req, res) => {
    if (!updateTokenMatches(req.headers.authorization, options.workerToken)) { res.sendStatus(401); return; }
    await updates.report(workerReportSchema.parse(req.body)); res.json({ ok: true });
  }));
  app.post("/internal/updates/automatic", wrap(async (req, res) => {
    if (!updateTokenMatches(req.headers.authorization, options.workerToken)) { res.sendStatus(401); return; }
    if (!(await updates.policy()).policy.openclawAutomatic) throw new UpdateError(409, "disabled", "Automatic updates are disabled.");
    res.status(202).json(await updates.enqueue("automatic", null));
  }));
  app.get("/internal/updates/workspace", wrap(async (req, res) => {
    if (!updateTokenMatches(req.headers.authorization, options.workspaceToken)) { res.sendStatus(401); return; }
    res.json({ ...(await updates.policy()), ...(await updates.maintenance()) });
  }));
  app.post("/internal/updates/codex", wrap(async (req, res) => {
    if (!updateTokenMatches(req.headers.authorization, options.workspaceToken)) { res.sendStatus(401); return; }
    const status = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/), lastCheck: z.string().datetime().nullable(),
      result: z.enum(["current", "updated", "failed", "disabled", "checking", "not-due", "busy"]), message: z.string().max(200) }).strict().parse(req.body);
    await updates.reportCodex(status); res.json({ ok: true });
  }));
}
