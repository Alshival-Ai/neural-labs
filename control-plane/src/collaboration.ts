import { randomUUID } from "node:crypto";

import type { Pool, PoolClient, QueryResultRow } from "pg";

import { hashToken, randomToken } from "./crypto.js";
import type { UserRecord } from "./types.js";

export const TEAM_CHAT_LIMITS = {
  attachmentsPerMessage: 100,
  importedCharacters: 16 * 1024 * 1024,
  importedMessages: 2_000,
  membersPerChannel: 2_000,
  messageCharacters: 128 * 1024,
  messagesPerPage: 500,
  agentContextMessages: 250,
} as const;

export type ChannelAudience = "restricted" | "everyone";
export type ChannelAuthorKind = "user" | "neura" | "system" | "imported_user" | "imported_neura";

export type ChannelAttachment = {
  path: string;
  name: string;
  type?: string | undefined;
  size?: number | undefined;
};

export type TeamDirectoryUser = Pick<UserRecord, "id" | "handle" | "displayName" | "role">;

export type TeamChannel = {
  id: string;
  name: string;
  audience: ChannelAudience;
  ownerUserId: string;
  pinned: boolean;
  pinnedAt?: string;
  memberCount: number;
  unreadCount: number;
  mentionCount: number;
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
  canManage: boolean;
  canPin: boolean;
};

export type TeamMessage = {
  id: string;
  sequence: number;
  channelId: string;
  authorKind: ChannelAuthorKind;
  author?: TeamDirectoryUser;
  body: string;
  attachments: ChannelAttachment[];
  mentions: string[];
  agentRunId?: string;
  createdAt: string;
};

export type TeamAgentRun = {
  id: string;
  channelId: string;
  triggerMessageId: string;
  status: "queued" | "running" | "completed" | "failed";
  error?: string;
  createdAt: string;
};

interface ChannelRow extends QueryResultRow {
  id: string;
  name: string;
  audience: ChannelAudience;
  owner_user_id: string;
  source_session_key: string | null;
  pinned_at: Date | null;
  pinned_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface MessageRow extends QueryResultRow {
  id: string;
  sequence: string;
  channel_id: string;
  author_kind: ChannelAuthorKind;
  author_user_id: string | null;
  body: string;
  attachments: unknown;
  agent_run_id: string | null;
  created_at: Date;
  handle: string | null;
  display_name: string | null;
  role: "admin" | "user" | null;
  mentions: string[] | null;
}

interface RunRow extends QueryResultRow {
  id: string;
  channel_id: string;
  trigger_message_id: string;
  requested_by: string | null;
  capability_hash: string;
  status: TeamAgentRun["status"];
  error: string | null;
  expires_at: Date;
  created_at: Date;
}

export class CollaborationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function attachments(value: unknown): ChannelAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ChannelAttachment[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.path !== "string" || typeof row.name !== "string") return [];
    return [{
      path: row.path,
      name: row.name,
      ...(typeof row.type === "string" ? { type: row.type } : {}),
      ...(typeof row.size === "number" ? { size: row.size } : {}),
    }];
  });
}

function mapMessage(row: MessageRow): TeamMessage {
  return {
    id: row.id,
    sequence: Number(row.sequence),
    channelId: row.channel_id,
    authorKind: row.author_kind,
    ...(row.author_user_id && row.handle && row.display_name && row.role
      ? { author: { id: row.author_user_id, handle: row.handle, displayName: row.display_name, role: row.role } }
      : {}),
    body: row.body,
    attachments: attachments(row.attachments),
    mentions: row.mentions ?? [],
    ...(row.agent_run_id ? { agentRunId: row.agent_run_id } : {}),
    createdAt: row.created_at.toISOString(),
  };
}

function mapRun(row: RunRow): TeamAgentRun {
  return {
    id: row.id,
    channelId: row.channel_id,
    triggerMessageId: row.trigger_message_id,
    status: row.status,
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at.toISOString(),
  };
}

function assertAttachments(input: ChannelAttachment[]): ChannelAttachment[] {
  if (input.length > TEAM_CHAT_LIMITS.attachmentsPerMessage) {
    throw new CollaborationError(422, "too_many_attachments", `A message can include up to ${TEAM_CHAT_LIMITS.attachmentsPerMessage} workspace files.`);
  }
  return input.map((item) => {
    const path = item.path.trim();
    const name = item.name.trim();
    if (!path || path.length > 4096 || path.startsWith("/") || path.split("/").includes("..")) {
      throw new CollaborationError(422, "invalid_attachment", "Attachment paths must stay inside the shared workspace.");
    }
    if (!name || name.length > 255 || (item.type?.length ?? 0) > 200 || (item.size ?? 0) < 0) {
      throw new CollaborationError(422, "invalid_attachment", "Attachment metadata is invalid.");
    }
    return { path, name, ...(item.type ? { type: item.type } : {}), ...(item.size !== undefined ? { size: item.size } : {}) };
  });
}

const MESSAGE_SELECT = `
  SELECT m.*, u.handle, u.display_name, u.role,
    COALESCE(array_agg(mm.user_id::text) FILTER (WHERE mm.user_id IS NOT NULL), '{}') AS mentions
  FROM team_messages m
  LEFT JOIN users u ON u.id = m.author_user_id
  LEFT JOIN team_message_mentions mm ON mm.message_id = m.id
`;

export class CollaborationStore {
  constructor(readonly pool: Pool) {}

  async directory(): Promise<TeamDirectoryUser[]> {
    const result = await this.pool.query<QueryResultRow & { id: string; handle: string; display_name: string; role: "admin" | "user" }>(
      "SELECT id, handle, display_name, role FROM users WHERE status = 'active' ORDER BY lower(display_name), lower(handle)",
    );
    return result.rows.map((row) => ({ id: row.id, handle: row.handle, displayName: row.display_name, role: row.role }));
  }

  async createSocketTicket(userId: string): Promise<{ ticket: string; expiresAt: string }> {
    const ticket = randomToken();
    const expiresAt = new Date(Date.now() + 60_000);
    await this.pool.query("DELETE FROM team_socket_tickets WHERE expires_at <= now()");
    await this.pool.query(
      "INSERT INTO team_socket_tickets(token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
      [hashToken(ticket), userId, expiresAt],
    );
    return { ticket, expiresAt: expiresAt.toISOString() };
  }

  async consumeSocketTicket(ticket: string): Promise<UserRecord | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query<{ user_id: string }>(
        `DELETE FROM team_socket_tickets
         WHERE token_hash = $1 AND expires_at > now()
         RETURNING user_id`,
        [hashToken(ticket)],
      );
      const userId = claimed.rows[0]?.user_id;
      if (!userId) {
        await client.query("ROLLBACK");
        return undefined;
      }
      const result = await client.query<QueryResultRow & {
        id: string; email: string; handle: string; display_name: string; role: "admin" | "user"; status: UserRecord["status"]; created_at: Date; updated_at: Date;
      }>("SELECT * FROM users WHERE id = $1 AND status = 'active'", [userId]);
      await client.query("COMMIT");
      const row = result.rows[0];
      return row ? { id: row.id, email: row.email, handle: row.handle, displayName: row.display_name, role: row.role, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at } : undefined;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listChannels(actor: UserRecord): Promise<TeamChannel[]> {
    const result = await this.pool.query<QueryResultRow & ChannelRow & {
      member_count: string;
      unread_count: string;
      mention_count: string;
      last_message_at: Date | null;
    }>(
      `SELECT c.*,
         CASE WHEN c.audience = 'everyone'
           THEN (SELECT count(*) FROM users WHERE status = 'active')
           ELSE (SELECT count(*) FROM team_channel_members cm WHERE cm.channel_id = c.id)
         END::text AS member_count,
         (SELECT count(*) FROM team_messages m
          WHERE m.channel_id = c.id
            AND m.sequence > COALESCE((SELECT r.last_read_sequence FROM team_channel_reads r WHERE r.channel_id = c.id AND r.user_id = $1), 0)
            AND m.author_user_id IS DISTINCT FROM $1)::text AS unread_count,
         (SELECT count(*) FROM team_messages m
          JOIN team_message_mentions mm ON mm.message_id = m.id AND mm.user_id = $1
          WHERE m.channel_id = c.id
            AND m.sequence > COALESCE((SELECT r.last_read_sequence FROM team_channel_reads r WHERE r.channel_id = c.id AND r.user_id = $1), 0))::text AS mention_count,
         (SELECT max(m.created_at) FROM team_messages m WHERE m.channel_id = c.id) AS last_message_at
       FROM team_channels c
       WHERE c.audience = 'everyone' OR c.owner_user_id = $1
          OR EXISTS (SELECT 1 FROM team_channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $1)
       ORDER BY c.pinned_at DESC NULLS LAST, COALESCE((SELECT max(m.created_at) FROM team_messages m WHERE m.channel_id = c.id), c.updated_at) DESC`,
      [actor.id],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      audience: row.audience,
      ownerUserId: row.owner_user_id,
      pinned: Boolean(row.pinned_at),
      ...(row.pinned_at ? { pinnedAt: row.pinned_at.toISOString() } : {}),
      memberCount: Number(row.member_count),
      unreadCount: Number(row.unread_count),
      mentionCount: Number(row.mention_count),
      ...(row.last_message_at ? { lastMessageAt: row.last_message_at.toISOString() } : {}),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      canManage: actor.role === "admin" || row.owner_user_id === actor.id,
      canPin: actor.role === "admin",
    }));
  }

  private async channelRow(client: Pool | PoolClient, channelId: string): Promise<ChannelRow | undefined> {
    const result = await client.query<ChannelRow>("SELECT * FROM team_channels WHERE id = $1", [channelId]);
    return result.rows[0];
  }

  private async canAccess(client: Pool | PoolClient, channel: ChannelRow, userId: string): Promise<boolean> {
    if (channel.audience === "everyone" || channel.owner_user_id === userId) return true;
    const result = await client.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM team_channel_members WHERE channel_id = $1 AND user_id = $2) AS exists",
      [channel.id, userId],
    );
    return result.rows[0]?.exists ?? false;
  }

  async canUserAccess(channelId: string, userId: string): Promise<boolean> {
    const channel = await this.channelRow(this.pool, channelId);
    return Boolean(channel && await this.canAccess(this.pool, channel, userId));
  }

  private async requireAccess(client: Pool | PoolClient, channelId: string, userId: string): Promise<ChannelRow> {
    const channel = await this.channelRow(client, channelId);
    if (!channel || !(await this.canAccess(client, channel, userId))) {
      throw new CollaborationError(404, "channel_not_found", "Team channel not found.");
    }
    return channel;
  }

  private async requireManager(client: Pool | PoolClient, channelId: string, actor: UserRecord): Promise<ChannelRow> {
    const channel = await this.channelRow(client, channelId);
    if (!channel) throw new CollaborationError(404, "channel_not_found", "Team channel not found.");
    if (actor.role !== "admin" && channel.owner_user_id !== actor.id) {
      throw new CollaborationError(403, "channel_manager_required", "Only the channel creator or an administrator can make this change.");
    }
    return channel;
  }

  async createChannel(actor: UserRecord, input: {
    name: string;
    audience: ChannelAudience;
    memberIds: string[];
    sourceSessionKey?: string | undefined;
    importedMessages?: Array<{ role: "user" | "assistant"; body: string; createdAt?: string | undefined }> | undefined;
  }): Promise<{ channel: TeamChannel; messages: TeamMessage[] }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const memberIds = [...new Set(input.memberIds.filter((id) => id !== actor.id))];
      if (input.audience === "restricted" && memberIds.length === 0) {
        throw new CollaborationError(422, "members_required", "Invite at least one teammate to a restricted channel.");
      }
      if (memberIds.length > TEAM_CHAT_LIMITS.membersPerChannel) {
        throw new CollaborationError(422, "too_many_members", `A channel can invite up to ${TEAM_CHAT_LIMITS.membersPerChannel} teammates at once.`);
      }
      if (memberIds.length) {
        const active = await client.query<{ id: string }>("SELECT id FROM users WHERE status = 'active' AND id = ANY($1::uuid[])", [memberIds]);
        if (active.rows.length !== memberIds.length) throw new CollaborationError(422, "invalid_members", "One or more invited accounts are not active.");
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO team_channels(id, name, audience, owner_user_id, source_session_key)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, input.name.trim(), input.audience, actor.id, input.sourceSessionKey ?? null],
      );
      const allMembers = [actor.id, ...memberIds];
      await client.query(
        `INSERT INTO team_channel_members(channel_id, user_id, added_by)
         SELECT $1, value::uuid, $2 FROM unnest($3::text[]) value`,
        [id, actor.id, allMembers],
      );
      const createdMessages: TeamMessage[] = [];
      if (input.importedMessages?.length) {
        const system = await this.insertMessage(client, {
          channelId: id,
          authorKind: "system",
          body: `Imported from a private Neura chat by @${actor.handle}.`,
          attachments: [],
        });
        createdMessages.push(system);
        for (const item of input.importedMessages.slice(-TEAM_CHAT_LIMITS.importedMessages)) {
          const body = item.body.trim().slice(0, TEAM_CHAT_LIMITS.messageCharacters);
          if (!body) continue;
          createdMessages.push(await this.insertMessage(client, {
            channelId: id,
            authorKind: item.role === "assistant" ? "imported_neura" : "imported_user",
            ...(item.role === "user" ? { authorUserId: actor.id } : {}),
            body,
            attachments: [],
            ...(item.createdAt ? { createdAt: item.createdAt } : {}),
          }));
        }
      } else {
        createdMessages.push(await this.insertMessage(client, {
          channelId: id,
          authorKind: "system",
          body: `@${actor.handle} created this channel.`,
          attachments: [],
        }));
      }
      const lastCreated = createdMessages.at(-1);
      if (lastCreated) {
        await client.query(
          `INSERT INTO team_channel_reads(channel_id, user_id, last_read_sequence)
           VALUES ($1, $2, $3)`,
          [id, actor.id, lastCreated.sequence],
        );
      }
      await client.query("COMMIT");
      const channel = (await this.listChannels(actor)).find((item) => item.id === id)!;
      return { channel, messages: createdMessages };
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof CollaborationError) throw error;
      if ((error as { code?: string }).code === "23505" && input.sourceSessionKey) {
        throw new CollaborationError(409, "chat_already_shared", "This private chat has already been shared as a channel.");
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async updateChannel(actor: UserRecord, channelId: string, input: { name?: string | undefined; pinned?: boolean | undefined }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const channel = input.pinned === undefined
        ? await this.requireManager(client, channelId, actor)
        : await this.channelRow(client, channelId);
      if (!channel) throw new CollaborationError(404, "channel_not_found", "Team channel not found.");
      if (input.pinned !== undefined && actor.role !== "admin") {
        throw new CollaborationError(403, "administrator_required", "Only administrators can pin channels.");
      }
      await client.query(
        `UPDATE team_channels SET
           name = COALESCE($2, name),
           pinned_at = CASE WHEN $3::boolean IS NULL THEN pinned_at WHEN $3 THEN now() ELSE NULL END,
           pinned_by = CASE WHEN $3::boolean IS NULL THEN pinned_by WHEN $3 THEN $4 ELSE NULL END,
           updated_at = now()
         WHERE id = $1`,
        [channelId, input.name ?? null, input.pinned ?? null, actor.id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteChannel(actor: UserRecord, channelId: string): Promise<void> {
    await this.requireManager(this.pool, channelId, actor);
    await this.pool.query("DELETE FROM team_channels WHERE id = $1", [channelId]);
  }

  async members(actor: UserRecord, channelId: string): Promise<TeamDirectoryUser[]> {
    const channel = await this.requireAccess(this.pool, channelId, actor.id);
    const result = channel.audience === "everyone"
      ? await this.pool.query<QueryResultRow & { id: string; handle: string; display_name: string; role: "admin" | "user" }>(
          "SELECT id, handle, display_name, role FROM users WHERE status = 'active' ORDER BY lower(display_name)",
        )
      : await this.pool.query<QueryResultRow & { id: string; handle: string; display_name: string; role: "admin" | "user" }>(
          `SELECT u.id, u.handle, u.display_name, u.role FROM users u
           JOIN team_channel_members cm ON cm.user_id = u.id
           WHERE cm.channel_id = $1 AND u.status = 'active' ORDER BY lower(u.display_name)`,
          [channelId],
        );
    return result.rows.map((row) => ({ id: row.id, handle: row.handle, displayName: row.display_name, role: row.role }));
  }

  async addMembers(actor: UserRecord, channelId: string, memberIds: string[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const channel = await this.requireManager(client, channelId, actor);
      if (channel.audience === "everyone") throw new CollaborationError(409, "everyone_channel", "Everyone channels already include every active user.");
      const unique = [...new Set(memberIds)].filter((id) => id !== channel.owner_user_id);
      const active = unique.length
        ? await client.query<QueryResultRow & { id: string; handle: string }>("SELECT id, handle FROM users WHERE status = 'active' AND id = ANY($1::uuid[])", [unique])
        : { rows: [] };
      if (active.rows.length !== unique.length) throw new CollaborationError(422, "invalid_members", "One or more invited accounts are not active.");
      for (const member of active.rows) {
        const inserted = await client.query(
          `INSERT INTO team_channel_members(channel_id, user_id, added_by) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING RETURNING user_id`,
          [channelId, member.id, actor.id],
        );
        if (inserted.rowCount) await this.insertMessage(client, { channelId, authorKind: "system", body: `@${actor.handle} added @${member.handle}.`, attachments: [] });
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async removeMember(actor: UserRecord, channelId: string, memberId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const channel = await this.channelRow(client, channelId);
      if (!channel) throw new CollaborationError(404, "channel_not_found", "Team channel not found.");
      if (channel.audience === "everyone") throw new CollaborationError(409, "everyone_channel", "Members cannot leave an Everyone channel.");
      if (memberId === channel.owner_user_id) throw new CollaborationError(409, "owner_required", "The channel creator cannot leave or be removed.");
      if (memberId !== actor.id && actor.role !== "admin" && actor.id !== channel.owner_user_id) {
        throw new CollaborationError(403, "channel_manager_required", "Only the channel creator or an administrator can remove another member.");
      }
      if (memberId === actor.id && !(await this.canAccess(client, channel, actor.id))) {
        throw new CollaborationError(404, "channel_not_found", "Team channel not found.");
      }
      const removedUser = await client.query<{ handle: string }>("SELECT handle FROM users WHERE id = $1", [memberId]);
      const removed = await client.query("DELETE FROM team_channel_members WHERE channel_id = $1 AND user_id = $2", [channelId, memberId]);
      if (removed.rowCount) {
        const handle = removedUser.rows[0]?.handle ?? "member";
        await this.insertMessage(client, { channelId, authorKind: "system", body: memberId === actor.id ? `@${handle} left the channel.` : `@${actor.handle} removed @${handle}.`, attachments: [] });
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listMessages(actor: UserRecord, channelId: string, before?: number, limit: number = TEAM_CHAT_LIMITS.messagesPerPage): Promise<TeamMessage[]> {
    await this.requireAccess(this.pool, channelId, actor.id);
    const result = await this.pool.query<MessageRow>(
      `${MESSAGE_SELECT}
       WHERE m.channel_id = $1 AND ($2::bigint IS NULL OR m.sequence < $2)
       GROUP BY m.sequence, m.id, u.id
       ORDER BY m.sequence DESC LIMIT $3`,
      [channelId, before ?? null, Math.min(Math.max(limit, 1), TEAM_CHAT_LIMITS.messagesPerPage)],
    );
    return result.rows.reverse().map(mapMessage);
  }

  async markRead(actor: UserRecord, channelId: string, sequence: number): Promise<void> {
    await this.requireAccess(this.pool, channelId, actor.id);
    await this.pool.query(
      `INSERT INTO team_channel_reads(channel_id, user_id, last_read_sequence)
       VALUES ($1, $2, $3)
       ON CONFLICT(channel_id, user_id) DO UPDATE SET
         last_read_sequence = GREATEST(team_channel_reads.last_read_sequence, EXCLUDED.last_read_sequence), updated_at = now()`,
      [channelId, actor.id, sequence],
    );
  }

  private async insertMessage(client: Pool | PoolClient, input: {
    channelId: string;
    authorKind: ChannelAuthorKind;
    authorUserId?: string;
    body: string;
    attachments: ChannelAttachment[];
    clientRequestId?: string;
    agentRunId?: string;
    createdAt?: string;
  }): Promise<TeamMessage> {
    const id = randomUUID();
    const result = await client.query<MessageRow>(
      `INSERT INTO team_messages(id, channel_id, author_kind, author_user_id, body, attachments, client_request_id, agent_run_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, COALESCE($9::timestamptz, now()))
       RETURNING *, NULL::text AS handle, NULL::text AS display_name, NULL::text AS role, '{}'::text[] AS mentions`,
      [id, input.channelId, input.authorKind, input.authorUserId ?? null, input.body, JSON.stringify(input.attachments), input.clientRequestId ?? null, input.agentRunId ?? null, input.createdAt ?? null],
    );
    const row = result.rows[0]!;
    if (input.authorUserId) {
      const user = await client.query<{ handle: string; display_name: string; role: "admin" | "user" }>("SELECT handle, display_name, role FROM users WHERE id = $1", [input.authorUserId]);
      row.handle = user.rows[0]?.handle ?? null;
      row.display_name = user.rows[0]?.display_name ?? null;
      row.role = user.rows[0]?.role ?? null;
    }
    return mapMessage(row);
  }

  async postMessage(actor: UserRecord, input: {
    channelId: string;
    body: string;
    attachments: ChannelAttachment[];
    clientRequestId: string;
  }): Promise<{ message: TeamMessage; run?: TeamAgentRun & { capability: string } }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const channel = await this.requireAccess(client, input.channelId, actor.id);
      const body = input.body.trim();
      const safeAttachments = assertAttachments(input.attachments);
      if (!body && safeAttachments.length === 0) throw new CollaborationError(422, "message_required", "Write a message or attach a workspace file.");
      const normalizedBody = body || safeAttachments.map((item) => item.name).join(", ");
      const existing = await client.query<MessageRow>(
        `${MESSAGE_SELECT} WHERE m.author_user_id = $1 AND m.client_request_id = $2 GROUP BY m.sequence, m.id, u.id`,
        [actor.id, input.clientRequestId],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return { message: mapMessage(existing.rows[0]) };
      }
      const message = await this.insertMessage(client, {
        channelId: channel.id,
        authorKind: "user",
        authorUserId: actor.id,
        body: normalizedBody,
        attachments: safeAttachments,
        clientRequestId: input.clientRequestId,
      });
      const handles = [...normalizedBody.matchAll(/(?:^|[\s([{:;,])@([a-z0-9][a-z0-9._-]{1,31})\b/gi)].map((match) => match[1]!.toLowerCase());
      if (handles.length) {
        const mentioned = await client.query<{ id: string }>(
          `SELECT u.id FROM users u WHERE u.status = 'active' AND lower(u.handle) = ANY($1::text[])
             AND ($2 = 'everyone' OR EXISTS (SELECT 1 FROM team_channel_members cm WHERE cm.channel_id = $3 AND cm.user_id = u.id))`,
          [[...new Set(handles)], channel.audience, channel.id],
        );
        for (const user of mentioned.rows) {
          await client.query("INSERT INTO team_message_mentions(message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [message.id, user.id]);
        }
        message.mentions = mentioned.rows.map((user) => user.id);
      }
      let run: (TeamAgentRun & { capability: string }) | undefined;
      if (/(?:^|\s)\$neura\b/i.test(normalizedBody)) {
        const capability = randomToken();
        const runRow = await client.query<RunRow>(
          `INSERT INTO team_agent_runs(id, channel_id, trigger_message_id, requested_by, capability_hash, status, expires_at)
           VALUES ($1, $2, $3, $4, $5, 'queued', now() + interval '20 minutes') RETURNING *`,
          [randomUUID(), channel.id, message.id, actor.id, hashToken(capability)],
        );
        run = { ...mapRun(runRow.rows[0]!), capability };
      }
      await client.query("UPDATE team_channels SET updated_at = now() WHERE id = $1", [channel.id]);
      await client.query("COMMIT");
      return { message, ...(run ? { run } : {}) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async claimRun(runId: string): Promise<TeamAgentRun | undefined> {
    const result = await this.pool.query<RunRow>(
      `UPDATE team_agent_runs SET status = 'running', started_at = now()
       WHERE id = $1 AND status = 'queued' AND expires_at > now() RETURNING *`,
      [runId],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : undefined;
  }

  async runContext(runId: string): Promise<{ channel: ChannelRow; trigger: TeamMessage; messages: TeamMessage[] } | undefined> {
    const run = await this.pool.query<RunRow>("SELECT * FROM team_agent_runs WHERE id = $1", [runId]);
    const row = run.rows[0];
    if (!row) return undefined;
    const channel = await this.channelRow(this.pool, row.channel_id);
    if (!channel) return undefined;
    const messages = await this.pool.query<MessageRow>(
      `${MESSAGE_SELECT} WHERE m.channel_id = $1 GROUP BY m.sequence, m.id, u.id ORDER BY m.sequence DESC LIMIT $2`,
      [channel.id, TEAM_CHAT_LIMITS.agentContextMessages],
    );
    const mapped = messages.rows.reverse().map(mapMessage);
    return { channel, trigger: mapped.find((item) => item.id === row.trigger_message_id)!, messages: mapped };
  }

  async postAgentMessage(capability: string, body: string): Promise<TeamMessage> {
    const result = await this.pool.query<RunRow>(
      `SELECT * FROM team_agent_runs WHERE capability_hash = $1 AND status = 'running' AND expires_at > now()`,
      [hashToken(capability)],
    );
    const run = result.rows[0];
    if (!run) throw new CollaborationError(403, "agent_capability_invalid", "This Neura channel capability is invalid or expired.");
    const normalizedBody = body.trim().slice(0, TEAM_CHAT_LIMITS.messageCharacters);
    if (!normalizedBody) throw new CollaborationError(422, "message_required", "Neura cannot post an empty channel message.");
    const message = await this.insertMessage(this.pool, {
      channelId: run.channel_id,
      authorKind: "neura",
      body: normalizedBody,
      attachments: [],
      agentRunId: run.id,
    });
    await this.pool.query("UPDATE team_channels SET updated_at = now() WHERE id = $1", [run.channel_id]);
    return message;
  }

  async messagesForCapability(capability: string, before?: number, limit: number = TEAM_CHAT_LIMITS.messagesPerPage): Promise<TeamMessage[]> {
    const run = await this.pool.query<RunRow>(
      "SELECT * FROM team_agent_runs WHERE capability_hash = $1 AND status = 'running' AND expires_at > now()",
      [hashToken(capability)],
    );
    if (!run.rows[0]) throw new CollaborationError(403, "agent_capability_invalid", "This Neura channel capability is invalid or expired.");
    const result = await this.pool.query<MessageRow>(
      `${MESSAGE_SELECT} WHERE m.channel_id = $1 AND ($2::bigint IS NULL OR m.sequence < $2)
       GROUP BY m.sequence, m.id, u.id ORDER BY m.sequence DESC LIMIT $3`,
      [run.rows[0].channel_id, before ?? null, Math.min(Math.max(limit, 1), TEAM_CHAT_LIMITS.messagesPerPage)],
    );
    return result.rows.reverse().map(mapMessage);
  }

  async channelForCapability(capability: string): Promise<{
    id: string;
    name: string;
    audience: ChannelAudience;
    members: TeamDirectoryUser[];
  }> {
    const run = await this.pool.query<RunRow>(
      "SELECT * FROM team_agent_runs WHERE capability_hash = $1 AND status = 'running' AND expires_at > now()",
      [hashToken(capability)],
    );
    const runRow = run.rows[0];
    if (!runRow) throw new CollaborationError(403, "agent_capability_invalid", "This Neura channel capability is invalid or expired.");
    const channel = await this.channelRow(this.pool, runRow.channel_id);
    if (!channel) throw new CollaborationError(404, "channel_not_found", "Team channel not found.");
    const memberRows = channel.audience === "everyone"
      ? await this.pool.query<QueryResultRow & { id: string; handle: string; display_name: string; role: "admin" | "user" }>(
          "SELECT id, handle, display_name, role FROM users WHERE status = 'active' ORDER BY lower(display_name)",
        )
      : await this.pool.query<QueryResultRow & { id: string; handle: string; display_name: string; role: "admin" | "user" }>(
          `SELECT u.id, u.handle, u.display_name, u.role FROM users u
           JOIN team_channel_members cm ON cm.user_id = u.id
           WHERE cm.channel_id = $1 AND u.status = 'active' ORDER BY lower(u.display_name)`,
          [channel.id],
        );
    return {
      id: channel.id,
      name: channel.name,
      audience: channel.audience,
      members: memberRows.rows.map((row) => ({ id: row.id, handle: row.handle, displayName: row.display_name, role: row.role })),
    };
  }

  async agentPosted(runId: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>("SELECT EXISTS(SELECT 1 FROM team_messages WHERE agent_run_id = $1 AND author_kind = 'neura') AS exists", [runId]);
    return result.rows[0]?.exists ?? false;
  }

  async finishRun(runId: string, error?: string): Promise<TeamAgentRun | undefined> {
    const result = await this.pool.query<RunRow>(
      `UPDATE team_agent_runs SET status = $2, error = $3, completed_at = now(), expires_at = now()
       WHERE id = $1 AND status IN ('queued', 'running') RETURNING *`,
      [runId, error ? "failed" : "completed", error ?? null],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : undefined;
  }

  async publicMcpActor(tenantId: string, subject: string, objectId?: string): Promise<UserRecord | undefined> {
    const candidates = [`${tenantId}:${objectId ?? subject}`, `${tenantId}:${subject}`];
    const result = await this.pool.query<QueryResultRow & {
      id: string; email: string; handle: string; display_name: string; role: "admin" | "user"; status: UserRecord["status"]; created_at: Date; updated_at: Date;
    }>(
      `SELECT u.* FROM users u JOIN identities i ON i.user_id = u.id
       WHERE u.status = 'active' AND i.provider = 'microsoft' AND i.subject = ANY($1::text[]) LIMIT 1`,
      [candidates],
    );
    const row = result.rows[0];
    return row ? { id: row.id, email: row.email, handle: row.handle, displayName: row.display_name, role: row.role, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at } : undefined;
  }
}
