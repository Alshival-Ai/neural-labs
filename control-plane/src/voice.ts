/** Conversation-bound audio sessions. Commercial policy is an optional admission hook. */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import type { Database } from './database.js';
import type { SessionService } from './sessions.js';
import type { SessionActor } from './types.js';
import type { ControlPlaneConfig } from './config.js';
import type { CollaborationStore, TeamAgentInvocation } from './collaboration.js';
import type { CollaborationEvent } from './server.js';
import { NativeExecutionAuthority } from './nativeRuntime.js';
import { portalExchange } from './managed.js';

const selection = z.object({ connection: z.string().uuid(), model: z.string().min(1).max(160) }).strict();
const startSchema = z.object({ requestId: z.string().uuid(), offer: z.string().startsWith('v=').max(100000),
  conversation: z.string().min(1).max(200).optional(), channel: z.string().uuid().optional(), selection: selection.optional(),
  approvalPolicy: z.enum(['on-request', 'never']).default('on-request') }).strict()
  .refine(value => Boolean(value.channel) !== Boolean(value.conversation) && (Boolean(value.channel) || Boolean(value.selection)));
interface VoiceRow { id: string; actor_id: string; session_hash: string; context: z.infer<typeof startSchema> & { bindingGeneration?: number }; status: string; expires_at: Date; seen_at: Date }
interface VoiceEvent { event_id: string; request_id: string; data: Record<string, unknown> }
type Options = { sameOrigin: RequestHandler; active: (req: Request, res: Response) => Promise<SessionActor | undefined>;
  csrf: (req: Request, res: Response, actor: SessionActor) => boolean; fetch?: typeof fetch;
  store: CollaborationStore; publish: (event: CollaborationEvent) => void; enqueue: (run: TeamAgentInvocation) => void;
  admit?: (actor: SessionActor, session: string, request?: string) => Promise<void> };

export function registerVoice(app: Express, database: Database, sessions: SessionService, config: ControlPlaneConfig, options: Options) {
  const transport = options.fetch ?? fetch;
  const authority = new NativeExecutionAuthority(database, sessions);
  const wrap = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); }
    catch { if (!res.headersSent) res.status(403).json({ error: { message: 'Voice is unavailable for this conversation. Check access, audio configuration and the selected agent connection.' } }); }
  };
  async function runtime(path: string, input: unknown): Promise<any> {
    const response = await transport(new URL(path, config.workspace.controlUrl), { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.workspace.controlToken}` },
      body: JSON.stringify(input), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Voice runtime unavailable');
    return response.json();
  }
  async function admit(actor: SessionActor, id: string, request?: string) {
    if (options.admit) return options.admit(actor, id, request);
    if (!config.managed) return;
    const row = (await database.pool.query('SELECT subject FROM managed_identities WHERE user_id=$1 AND issuer=$2 AND workspace=$3',
      [actor.user.id, config.managed.portalOrigin, config.managed.workspace])).rows[0];
    if (!row) throw new Error('Managed identity unavailable');
    await portalExchange(config, 'voice-admit', { subject: row.subject, session: id, ...(request ? { request } : {}) });
  }
  async function current(id: string) {
    const row = (await database.pool.query<VoiceRow>("SELECT * FROM voice_sessions WHERE id=$1 AND status IN ('connecting','live') AND expires_at>now() AND seen_at>now() - CASE WHEN status='connecting' THEN interval '45 seconds' ELSE interval '20 seconds' END", [id])).rows[0];
    if (!row) throw new Error('Voice session ended');
    const actor = await sessions.actorByTokenHash(row.session_hash);
    if (!actor || actor.user.id !== row.actor_id) throw new Error('Voice access revoked');
    const gate = (await database.pool.query('SELECT gate FROM update_runtime WHERE singleton')).rows[0];
    if (!gate || gate.gate !== false) throw new Error('Workspace maintenance');
    if (row.context.channel) await options.store.listMessages(actor.user, row.context.channel);
    else {
      const connection = await authority.connection(actor, row.context.selection!.connection, 'turns.start');
      if (connection.generation !== row.context.bindingGeneration) throw new Error('Provider connection changed');
    }
    await admit(actor, id);
    return { row, actor };
  }
  async function native(actor: SessionActor, row: VoiceRow, operation: string, params: Record<string, unknown>) {
    const lease = await authority.issue(actor, row.context.selection!, operation, operation === 'turns.start' ? row.context.approvalPolicy : 'on-request');
    return runtime('/internal/native/request', { actor: actor.user.id, lease, operation, params });
  }
  app.get('/api/voice/capabilities', wrap(async (req, res) => {
    const actor = await options.active(req, res); if (!actor) return;
    await admit(actor, randomUUID());
    res.json({ protocol: 1, live: true, maxSeconds: 300 });
  }));
  app.post('/api/voice/sessions', options.sameOrigin, wrap(async (req, res) => {
    const actor = await options.active(req, res); if (!actor || !options.csrf(req, res, actor)) return;
    const input = startSchema.parse(req.body), id = input.requestId;
    await admit(actor, id);
    const active = await database.pool.query("SELECT id FROM voice_sessions WHERE actor_id=$1 AND status IN ('connecting','live') AND expires_at>now() AND seen_at>now() - CASE WHEN status='connecting' THEN interval '45 seconds' ELSE interval '20 seconds' END", [actor.user.id]);
    if (active.rowCount) throw new Error('A voice session is already active');
    await database.pool.query("UPDATE voice_sessions SET status='ended' WHERE actor_id=$1 AND (expires_at<=now() OR seen_at<now()-interval '45 seconds')",[actor.user.id]);
    const { offer, ...baseContext } = input;
    const context = { ...baseContext, ...(!input.channel ? { bindingGeneration: (await authority.connection(actor, input.selection!.connection, 'turns.start')).generation } : {}) };
    await database.pool.query("INSERT INTO voice_sessions(id,actor_id,session_hash,context,status,expires_at) VALUES($1,$2,$3,$4,'connecting',now()+interval '5 minutes')", [id, actor.user.id, actor.session.tokenHash, context]);
    try {
      const { row } = await current(id);
      if (!input.channel) await native(actor, row, 'events.read', { conversation: input.conversation, after: 0 });
      const result = await runtime('/internal/voice/session', { operation: 'start', id, userId: actor.user.id, offer });
      await database.pool.query("UPDATE voice_sessions SET status='live',seen_at=now() WHERE id=$1", [id]);
      res.status(201).json(result);
    } catch (error) {
      await database.pool.query("UPDATE voice_sessions SET status='error' WHERE id=$1", [id]);
      await runtime('/internal/voice/session', { operation: 'end', id }).catch(() => {});
      throw error;
    }
  }));
  app.post('/api/voice/sessions/:id/:operation', options.sameOrigin, wrap(async (req, res) => {
    const actor = await options.active(req, res); if (!actor || !options.csrf(req, res, actor)) return;
    const id = z.string().uuid().parse(req.params.id);
    const row = (await database.pool.query<VoiceRow>('SELECT * FROM voice_sessions WHERE id=$1 AND actor_id=$2 AND session_hash=$3', [id, actor.user.id, actor.session.tokenHash])).rows[0];
    if (!row) throw new Error('Unknown voice session');
    if (req.params.operation === 'end') {
      await database.pool.query("UPDATE voice_sessions SET status='ended' WHERE id=$1", [id]);
      await runtime('/internal/voice/session', { operation: 'end', id }); res.json({ ended: true }); return;
    }
    if (req.params.operation !== 'heartbeat') throw new Error('Unknown operation');
    await current(id);
    await database.pool.query('UPDATE voice_sessions SET seen_at=now() WHERE id=$1', [id]);
    res.json({ status: row.status });
  }));
  app.post('/internal/voice/callback', wrap(async (req, res) => {
    const supplied = Buffer.from(req.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '');
    const expected = Buffer.from(config.workspace.controlToken);
    if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('Unauthorized');
    const input = z.object({ id: z.string().uuid(), operation: z.enum(['authorize','request','result','record','ended']),
      requestId: z.string().uuid().optional(), event: z.string().max(200).optional(), body: z.string().min(1).max(12000).optional(),
      kind: z.enum(['usage','spoken']).optional(), data: z.unknown().optional() }).strict().parse(req.body);
    if (input.operation === 'ended') {
      await database.pool.query("UPDATE voice_sessions SET status='ended' WHERE id=$1", [input.id]); res.json({ ended: true }); return;
    }
    const { actor, row } = await current(input.id);
    if (input.operation === 'authorize') { res.json({ allowed: true }); return; }
    if (input.operation === 'record') {
      if (!input.event || !input.kind || JSON.stringify(input.data).length > 64000) throw new Error('Invalid event');
      await database.pool.query('INSERT INTO voice_events(session_id,event_id,kind,data) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [row.id,input.event,input.kind,JSON.stringify(input.data)]);
      res.json({ saved: true }); return;
    }
    if (!input.requestId) throw new Error('Request identifier required');
    let event = (await database.pool.query<VoiceEvent>('SELECT * FROM voice_events WHERE session_id=$1 AND request_id=$2', [row.id,input.requestId])).rows[0];
    if (input.operation === 'request') {
      if (!input.body || !input.event) throw new Error('Transcript required');
      if (!event) {
        const inserted = await database.pool.query('INSERT INTO voice_events(session_id,event_id,request_id,kind,data) VALUES($1,$2,$3,\'request\',$4) ON CONFLICT DO NOTHING RETURNING *', [row.id,input.event,input.requestId,{ body: input.body }]);
        if (!inserted.rowCount) throw new Error('Duplicate voice event');
        await admit(actor,row.id,input.requestId);
        let result;
        if (row.context.channel) {
          const posted = await options.store.postMessage(actor.user,{ channelId: row.context.channel, body: '@Alshival ' + input.body, attachments: [], clientRequestId: input.requestId });
          options.publish({type:'message.created',channelId:row.context.channel,message:posted.message});
          if (posted.run) { options.enqueue(posted.run); result = { run: posted.run.id }; }
          else throw new Error('No channel agent available');
        } else {
          result = await native(actor,row,'turns.start',{conversation:row.context.conversation,requestId:input.requestId,input:[{type:'text',text:input.body}]});
        }
        await database.pool.query('UPDATE voice_events SET data=data || $3::jsonb WHERE session_id=$1 AND request_id=$2', [row.id,input.requestId,JSON.stringify(result)]);
        event = (await database.pool.query<VoiceEvent>('SELECT * FROM voice_events WHERE session_id=$1 AND request_id=$2',[row.id,input.requestId])).rows[0];
      } else if (event.data.body !== input.body) throw new Error('Changed retry');
    }
    if (!event) throw new Error('Unknown request');
    if (row.context.channel) {
      if (!event.data.run) throw new Error('Request outcome is unknown. Inspect the channel before retrying.');
      const messages = await options.store.listMessages(actor.user,row.context.channel);
      const reply = messages.find(message => message.agentRunId === event.data.run && message.authorKind === 'neura');
      const run = (await database.pool.query('SELECT status FROM team_agent_runs WHERE id=$1 AND channel_id=$2', [event.data.run,row.context.channel])).rows[0];
      res.json(reply ? { answer: reply.body } : run && ['failed','cancelled'].includes(run.status) ? { answer: 'The agent did not complete the request. Check the channel activity.' } : { pending: true });
    } else {
      if (!event.data.id) throw new Error('Request outcome is unknown. Inspect the chat before retrying.');
      let cursor = 0;
      const events: any[] = [];
      for (let page = 0; page < 100; page++) {
        const result = await native(actor,row,'events.read',{conversation:row.context.conversation,after:cursor});
        events.push(...(result.events ?? []).filter((item: any) => item.turn_id === event.data.id));
        if ((result.events ?? []).length < 1000 || result.cursor <= cursor) break;
        cursor = result.cursor;
      }
      const done = events.find((item: any) => item.type === 'turn-completed');
      const failed = done && done.payload.status !== 'succeeded';
      const text = events.filter((item: any) => item.type === 'output').map((item: any) => item.payload.delta ?? item.payload.text ?? '').join('');
      res.json(failed ? { answer: 'The agent could not complete the request. Check the chat activity.' } : done ? { answer: text || 'The agent completed the request. See the chat for details.' } : { pending: true });
    }
  }));
}
