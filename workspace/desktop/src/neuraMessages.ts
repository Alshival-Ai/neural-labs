import { stripTerminalContext } from "./terminalAgentApi";
import { projectGeneratedMedia, workspacePathFromMessageReference } from "./neuraMedia";
import type { GatewayEvent, NeuraActivity, NeuraMessage } from "./types";
type RecordValue = Record<string, unknown>;
function isRecord(value: unknown): value is RecordValue { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
const MANAGED_MEDIA_PATH = /^\/api\/chat\/media\/outgoing\/([^/]+)\/([A-Za-z0-9-]{1,128})\/(full|thumbnail)$/u;
const MANAGED_MEDIA_TICKET = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const ACTIVITY_SECRET_ASSIGNMENT = /\b((?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|passwd|secret|authorization))\b(\s*[:=]\s*)([^\s,;]+)/gi;
const ACTIVITY_BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+/gi;
const ACTIVITY_OPENAI_KEY = /\bsk-[A-Za-z0-9_-]{12,}\b/g;

function safeActivityText(value: unknown, limit: number): string {
  const text = typeof value === "string" ? value : "";
  return stripTerminalContext(text)
    .replace(ACTIVITY_BEARER, "Bearer [redacted]")
    .replace(ACTIVITY_OPENAI_KEY, "[redacted]")
    .replace(ACTIVITY_SECRET_ASSIGNMENT, (_match, name: string, separator: string) => `${name}${separator}[redacted]`)
    .trim()
    .slice(0, limit);
}

function nestedActivityText(value: unknown, limit: number): string {
  if (typeof value === "string") return safeActivityText(value, limit);
  if (Array.isArray(value)) {
    return safeActivityText(value.map((item) => nestedActivityText(item, limit)).filter(Boolean).join("\n"), limit);
  }
  if (!isRecord(value)) return "";
  return nestedActivityText(value.output ?? value.text ?? value.content ?? value.message, limit);
}

function activityState(data: RecordValue): NeuraActivity["state"] {
  const value = (stringValue(data.status) ?? stringValue(data.state) ?? stringValue(data.phase) ?? "running").toLowerCase();
  if (["error", "failed", "failure"].includes(value) || data.isError === true) return "error";
  if (["done", "completed", "complete", "result", "end", "success", "succeeded"].includes(value)) return "done";
  return "running";
}

function activityArguments(data: RecordValue): RecordValue {
  for (const value of [data.args, data.arguments, data.input]) {
    if (isRecord(value)) return value;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (isRecord(parsed)) return parsed;
      } catch {
        return { input: value };
      }
    }
  }
  return {};
}

function activityCommand(args: RecordValue): string {
  const value = args.command ?? args.cmd;
  return safeActivityText(Array.isArray(value) ? value.map(String).join(" ") : value, 4_000);
}

function activityPlan(data: RecordValue, args: RecordValue): string {
  const value = Array.isArray(data.plan) ? data.plan : Array.isArray(data.steps) ? data.steps : Array.isArray(args.plan) ? args.plan : Array.isArray(args.steps) ? args.steps : [];
  const steps = value.slice(0, 20).map((candidate) => {
    if (typeof candidate === "string") return safeActivityText(candidate, 240);
    if (!isRecord(candidate)) return "";
    const text = safeActivityText(candidate.step ?? candidate.title ?? candidate.text, 240);
    const status = safeActivityText(candidate.status, 40).replaceAll("_", " ");
    return text ? `${status ? `${status}: ` : ""}${text}` : "";
  }).filter(Boolean);
  return safeActivityText(steps.join("\n") || (data.explanation ?? args.explanation), 3_000);
}

function activityForTool(data: RecordValue, sessionKey: string, runId?: string): NeuraActivity | null {
  const args = activityArguments(data);
  const result = isRecord(data.result) ? data.result : {};
  const resultDetails = isRecord(result.details) ? result.details : {};
  const name = (stringValue(data.name) ?? stringValue(data.toolName) ?? stringValue(data.tool) ?? "tool").toLowerCase();
  const toolCallId = stringValue(data.toolCallId) ?? stringValue(data.tool_call_id) ?? stringValue(data.callId) ?? stringValue(data.id);
  if (!toolCallId) return null;
  const state = activityState({ ...resultDetails, ...result, ...data });
  const command = activityCommand(args);
  const isCommand = Boolean(command) || /(^|[._-])(exec|bash|shell|command|terminal)([._-]|$)/.test(name);
  const isPlan = name.includes("plan");
  const isFile = /(apply.?patch|write.?file|edit.?file|create.?file)/.test(name);
  const output = nestedActivityText(data.output ?? result.output ?? resultDetails.output, 12_000);
  const fileChange = safeActivityText(args.patch ?? args.diff ?? args.content ?? args.input, 12_000);
  const detail = safeActivityText(data.summary ?? data.detail ?? data.meta ?? data.toolErrorSummary, 2_400);
  const path = safeActivityText(args.path ?? args.filePath ?? args.file, 600);
  const exitCode = numberValue(data.exitCode) ?? numberValue(result.exitCode) ?? numberValue(resultDetails.exitCode);
  const durationMs = numberValue(data.durationMs) ?? numberValue(result.durationMs) ?? numberValue(resultDetails.durationMs);

  if (isPlan) {
    return { id: `plan:${toolCallId}`, sessionKey, runId, kind: "plan", title: state === "running" ? "Updating plan" : "Plan updated", detail: activityPlan(data, args) || detail, state };
  }
  if (isCommand) {
    return {
      id: `command:${toolCallId}`, sessionKey, runId, kind: "command",
      title: state === "running" ? "Running command" : state === "error" ? "Command failed" : "Command completed",
      ...(command ? { command } : {}), ...(output ? { output } : {}), ...(detail ? { detail } : {}),
      ...(exitCode !== undefined ? { exitCode } : {}), ...(durationMs !== undefined ? { durationMs } : {}), state,
    };
  }
  if (isFile) {
    return {
      id: `file:${toolCallId}`, sessionKey, runId, kind: "file",
      title: state === "running" ? "Updating files" : state === "error" ? "File update failed" : "Files updated",
      ...(path ? { path } : {}), ...(detail ? { detail } : {}), ...(fileChange || output ? { output: fileChange || output } : {}), state,
    };
  }
  const readableName = name.replace(/^mcp__/, "").replaceAll(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  return { id: `tool:${toolCallId}`, sessionKey, runId, kind: "tool", title: readableName || "Agent action", ...(detail ? { detail } : {}), state };
}

function mergeActivity(list: NeuraActivity[], activity: NeuraActivity): NeuraActivity[] {
  const previous = list.find((item) => item.id === activity.id);
  return [...list.filter((item) => item.id !== activity.id), { ...previous, ...activity }].slice(-80);
}

function foldAssistantProgress(messages: NeuraMessage[], sessionKey: string): NeuraMessage[] {
  const folded: NeuraMessage[] = [];
  for (let index = 0; index < messages.length;) {
    if (messages[index].role !== "assistant") {
      folded.push(messages[index]);
      index += 1;
      continue;
    }
    const group: NeuraMessage[] = [];
    while (index < messages.length && messages[index].role === "assistant") {
      group.push(messages[index]);
      index += 1;
    }
    if (group.length === 1) {
      folded.push(group[0]);
      continue;
    }
    const answerIndex = group.findLastIndex((message) => Boolean(message.text.trim() || message.attachments?.length));
    const answer = group[Math.max(0, answerIndex)];
    const activities: NeuraActivity[] = [];
    for (const [groupIndex, message] of group.entries()) {
      for (const activity of message.activities ?? []) activities.push(activity);
      if (groupIndex !== answerIndex && message.text.trim()) activities.push({
        id: `thinking:${message.id}`,
        sessionKey,
        kind: "thinking",
        title: "Progress update",
        detail: safeActivityText(message.text, 2_400),
        state: "done",
      });
    }
    folded.push({
      ...answer,
      ...(answerIndex < 0 ? { text: "" } : {}),
      ...(activities.length ? { activities } : {}),
    });
  }
  return folded;
}

export function activitiesFromGatewayEvent(event: GatewayEvent): NeuraActivity[] {
  const payload = eventRecord(event);
  if (!payload) return [];
  const sessionKey = stringValue(payload.sessionKey);
  if (!sessionKey) return [];
  const runId = stringValue(payload.runId);
  if (event.event === "session.operation") {
    const operation = stringValue(payload.operation)?.replaceAll(/[_-]+/g, " ") ?? "conversation maintenance";
    const state = activityState(payload);
    return [{
      id: `operation:${stringValue(payload.operationId) ?? operation}`,
      sessionKey, runId, kind: "operation",
      title: `${state === "running" ? "Running" : state === "error" ? "Failed" : "Completed"} ${operation}`,
      detail: safeActivityText(payload.reason, 2_400), state,
    }];
  }
  if (event.event !== "session.tool" && event.event !== "agent") return [];
  const stream = (stringValue(payload.stream) ?? "tool").toLowerCase();
  const data = isRecord(payload.data) ? payload.data : payload;
  if (stream === "thinking") {
    return [{ id: `thinking:${runId ?? "active"}`, sessionKey, runId, kind: "thinking", title: "Thinking", detail: "Reasoning through the request", state: activityState(data) }];
  }
  if (stream === "assistant" && stringValue(data.phase) === "commentary") {
    const detail = safeActivityText(data.text ?? data.delta, 2_400);
    return detail ? [{ id: `thinking:${stringValue(data.itemId) ?? runId ?? "active"}`, sessionKey, runId, kind: "thinking", title: "Progress update", detail, state: activityState(data) }] : [];
  }
  if (stream === "item" && (stringValue(data.kind) ?? "").toLowerCase() === "preamble") {
    const detail = safeActivityText(data.progressText ?? data.text ?? data.delta, 2_400);
    return detail ? [{
      id: `thinking:${stringValue(data.itemId) ?? runId ?? "active"}`,
      sessionKey,
      runId,
      kind: "thinking",
      title: "Progress update",
      detail,
      state: activityState(data),
    }] : [];
  }
  if (stream === "plan") {
    return [{ id: `plan:${runId ?? "active"}`, sessionKey, runId, kind: "plan", title: "Plan updated", detail: activityPlan(data, {}), state: activityState(data) }];
  }
  if (stream === "command_output") {
    const commandActivity = activityForTool({ ...data, name: data.name ?? "exec", status: data.status ?? data.phase }, sessionKey, runId);
    return commandActivity ? [commandActivity] : [];
  }
  if (stream === "tool" || event.event === "session.tool") {
    const activity = activityForTool(data, sessionKey, runId);
    return activity ? [activity] : [];
  }
  return [];
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return "";
      const type = (stringValue(part.type) ?? "").toLowerCase().replaceAll(/[_-]+/g, "");
      if (["thinking", "reasoning", "toolcall", "tooluse", "functioncall", "toolresult", "tooloutput", "functionresult"].includes(type)) return "";
      return stringValue(part.text) ?? stringValue(part.content) ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

type AssistantMessagePhase = "commentary" | "final_answer";

function normalizedAssistantPhase(value: unknown): AssistantMessagePhase | undefined {
  if (typeof value !== "string") return undefined;
  const phase = value.toLowerCase().replaceAll("-", "_");
  return phase === "commentary" || phase === "final_answer" ? phase : undefined;
}

function assistantTextBlockPhase(value: unknown): AssistantMessagePhase | undefined {
  if (!isRecord(value)) return undefined;
  const direct = normalizedAssistantPhase(value.phase);
  if (direct) return direct;
  const signature = stringValue(value.textSignature);
  if (!signature?.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(signature) as unknown;
    return isRecord(parsed) && parsed.v === 1 ? normalizedAssistantPhase(parsed.phase) : undefined;
  } catch {
    return undefined;
  }
}

function assistantTextParts(content: unknown): Array<{ text: string; phase?: AssistantMessagePhase }> {
  if (typeof content === "string") return content ? [{ text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (typeof part === "string") return part ? [{ text: part }] : [];
    if (!isRecord(part)) return [];
    const type = (stringValue(part.type) ?? "").toLowerCase().replaceAll(/[_-]+/g, "");
    if (["thinking", "reasoning", "toolcall", "tooluse", "functioncall", "toolresult", "tooloutput", "functionresult"].includes(type)) return [];
    const text = stringValue(part.text) ?? stringValue(part.content) ?? "";
    return text ? [{ text, phase: assistantTextBlockPhase(part) }] : [];
  });
}

function assistantCommentaryText(value: unknown): string {
  return stripTerminalContext(rawAssistantCommentaryText(value));
}

function rawAssistantCommentaryText(value: unknown): string {
  if (!isRecord(value)) return "";
  const nested = isRecord(value.message) ? value.message : value;
  const directPhase = normalizedAssistantPhase(nested.phase) ?? normalizedAssistantPhase(value.phase);
  if (directPhase === "commentary") {
    return textFromContent(nested.content) || stringValue(nested.text) || stringValue(value.text) || "";
  }
  return assistantTextParts(nested.content).filter((part) => part.phase === "commentary").map((part) => part.text).join("\n");
}

function assistantAnswerText(value: RecordValue): string {
  return stripTerminalContext(rawAssistantAnswerText(value));
}

function rawAssistantAnswerText(value: RecordValue): string {
  const nested = isRecord(value.message) ? value.message : value;
  const directPhase = normalizedAssistantPhase(nested.phase) ?? normalizedAssistantPhase(value.phase);
  const parts = assistantTextParts(nested.content);
  const finalParts = parts.filter((part) => part.phase === "final_answer");
  if (finalParts.length) return finalParts.map((part) => part.text).join("\n");
  if (directPhase === "commentary") return "";
  const unphased = parts.filter((part) => !part.phase);
  return unphased.map((part) => part.text).join("\n") || stringValue(nested.text) || stringValue(value.text) || "";
}

function attachmentFromRecord(value: unknown): NonNullable<NeuraMessage["attachments"]> {
  if (!isRecord(value)) return [];
  const record = isRecord(value.attachment) ? value.attachment : value;
  const source = isRecord(record.source) ? record.source : {};
  const rawPath = stringValue(record.path) ?? stringValue(record.filePath) ?? stringValue(record.file_path);
  const path = workspacePathFromMessageReference(rawPath);
  const name = stringValue(record.fileName) ?? stringValue(record.file_name) ?? stringValue(record.name)
    ?? stringValue(record.title) ?? stringValue(record.label) ?? stringValue(record.alt) ?? path?.split("/").pop();
  const artifactId = stringValue(record.artifactId) ?? stringValue(record.artifact_id);
  const blockType = (stringValue(value.type) ?? stringValue(record.kind) ?? "").toLowerCase();
  let mimeType = stringValue(record.mimeType) ?? stringValue(record.mime_type) ?? stringValue(record.mediaType) ?? stringValue(record.media_type)
    ?? stringValue(source.mediaType) ?? stringValue(source.media_type);
  if (!mimeType && blockType === "image") mimeType = "image/*";
  if (!mimeType && blockType === "file") mimeType = "application/octet-stream";
  const directUrl = stringValue(record.url) ?? stringValue(record.imageUrl) ?? stringValue(record.image_url);
  const sourceUrl = stringValue(source.url);
  const base64 = stringValue(record.data) ?? stringValue(source.data) ?? (blockType === "image" ? stringValue(record.content) : undefined);
  const rawUrl = directUrl ?? sourceUrl;
  const managedUrl = workspaceNeuraMediaUrl(rawUrl);
  const url = managedUrl ?? (rawUrl && !managedGatewayMediaReference(rawUrl) ? rawUrl : undefined) ?? (mimeType?.startsWith("image/") && base64 && /^[A-Za-z0-9+/=\s]+$/.test(base64)
    ? `data:${mimeType};base64,${base64.replaceAll(/\s/g, "")}`
    : undefined);
  const size = typeof record.sizeBytes === "number" ? record.sizeBytes : typeof record.size === "number" ? record.size : undefined;
  if (!name && !url && !path && !artifactId) return [];
  return [{
    name: name ?? (mimeType?.startsWith("image/") ? "Generated image" : "Shared file"),
    type: mimeType ?? "application/octet-stream",
    ...(artifactId ? { artifactId } : {}),
    ...(typeof record.sourceUrl === "string" && /^https?:\/\//.test(record.sourceUrl) ? { sourceUrl: record.sourceUrl } : {}),
    ...(url ? { url } : {}),
    ...(path ? { path } : {}),
    ...(size !== undefined ? { size } : {}),
  }];
}

function managedGatewayMediaReference(reference: string): boolean {
  try {
    const parsed = new URL(reference, "https://openclaw.invalid");
    return MANAGED_MEDIA_PATH.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function workspaceNeuraMediaUrl(reference: string | undefined): string | undefined {
  if (!reference) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(reference, "https://openclaw.invalid");
  } catch {
    return undefined;
  }
  if (parsed.origin !== "https://openclaw.invalid" && !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) return undefined;
  const match = parsed.pathname.match(MANAGED_MEDIA_PATH);
  const ticket = parsed.searchParams.get("mediaTicket");
  if (!match || !ticket || !MANAGED_MEDIA_TICKET.test(ticket) || [...parsed.searchParams.keys()].some((key) => key !== "mediaTicket")) return undefined;
  return `/workspace/api/neura/media/outgoing/${match[1]}/${match[2]}/${match[3]}?mediaTicket=${encodeURIComponent(ticket)}`;
}

function attachmentsFromMessage(message: Record<string, unknown>): NonNullable<NeuraMessage["attachments"]> {
  const candidates = [
    ...(Array.isArray(message.attachments) ? message.attachments : []),
    ...(Array.isArray(message.content) ? message.content.filter((part) => {
      if (!isRecord(part)) return false;
      return ["image", "video", "audio", "file", "attachment", "document"].includes((stringValue(part.type) ?? "").toLowerCase().replaceAll(/[_-]+/g, ""));
    }) : []),
  ];
  const seen = new Set<string>();
  return candidates.flatMap(attachmentFromRecord).filter((attachment) => {
    const key = `${attachment.path ?? ""}\u0000${attachment.url ?? ""}\u0000${attachment.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeMessage(value: unknown, fallbackId: string): NeuraMessage[] {
  if (!isRecord(value)) return [];
  const rawRole = stringValue(value.role) ?? (isRecord(value.message) ? stringValue(value.message.role) : undefined);
  if (!rawRole || !["user", "assistant", "system"].includes(rawRole)) return [];
  const nested = isRecord(value.message) ? value.message : value;
  const text = rawRole === "assistant"
    ? normalizedMessagePhase(value) === "commentary"
      ? assistantCommentaryText(value)
      : assistantAnswerText(value)
    : textFromContent(nested.content) || stringValue(nested.text) || stringValue(value.text) || "";
  const generated = rawRole === "assistant"
    ? projectGeneratedMedia(text, attachmentsFromMessage(nested))
    : { text, attachments: attachmentsFromMessage(nested) };
  const attachments = generated.attachments;
  // Hide only native media marker lines backed by structured attachment metadata.
  // A filename-like caption without this provenance remains ordinary user text.
  const metadata = isRecord(nested.__openclaw) ? nested.__openclaw : {};
  const media = Array.isArray(metadata.media) ? metadata.media.filter(isRecord) : [];
  const references = new Set([...attachments.flatMap((item) => [item.path, item.url]), ...media.flatMap((item) => [stringValue(item.path), stringValue(item.url)])].filter(Boolean));
  const displayText = attachments.length ? generated.text.split("\n").filter((line) => {
    const marker = /^\[media attached: ([^\]\r\n]+)\]$/.exec(line);
    return !marker || !references.has(marker[1]);
  }).join("\n") : generated.text;
  if (!text && attachments.length === 0) return [];
  return [{
    id: stringValue(value.id) ?? stringValue(nested.id) ?? fallbackId,
    role: rawRole as NeuraMessage["role"],
    text: stripTerminalContext(displayText),
    ...(rawRole === "assistant" && Array.isArray(nested.content) && nested.content.some(isProposedPlanBlock) ? { proposedPlan: true } : {}),
    ...(attachments.length ? { attachments } : {}),
  }];
}

function normalizedMessagePhase(value: unknown): "commentary" | "final_answer" | undefined {
  if (!isRecord(value)) return undefined;
  const nested = isRecord(value.message) ? value.message : value;
  const direct = normalizedAssistantPhase(nested.phase) ?? normalizedAssistantPhase(value.phase);
  if (direct) return direct;
  const phases = new Set(assistantTextParts(nested.content).flatMap((part) => part.phase ? [part.phase] : []));
  return phases.size === 1 ? [...phases][0] : undefined;
}

function normalizedHistoryRole(value: RecordValue): string {
  return (stringValue(value.role) ?? (isRecord(value.message) ? stringValue(value.message.role) : undefined) ?? "")
    .toLowerCase().replaceAll(/[_-]+/g, "");
}

function historyBlocks(value: RecordValue): unknown[] {
  const nested = isRecord(value.message) ? value.message : value;
  return Array.isArray(nested.content) ? nested.content : [];
}

function historyBlockType(value: unknown): string {
  return isRecord(value) ? (stringValue(value.type) ?? "").toLowerCase().replaceAll(/[_-]+/g, "") : "";
}

export function normalizeNeuraHistory(
  rows: unknown[],
  sessionKey: string,
  options: { hideUnfinishedTail?: boolean } = {},
): NeuraMessage[] {
  const messages: NeuraMessage[] = [];
  let pending: NeuraActivity[] = [];
  const toolNames = new Map<string, string>();
  const finalAnswerIds = new Set<string>();

  const flushPending = () => {
    if (!pending.length) return;
    messages.push({ id: `${sessionKey}:activity:${messages.length}`, role: "assistant", text: "", activities: pending });
    pending = [];
  };

  rows.forEach((candidate, index) => {
    if (!isRecord(candidate)) return;
    const role = normalizedHistoryRole(candidate);
    const blocks = historyBlocks(candidate);
    if (role === "user") flushPending();

    for (const block of blocks) {
      if (!isRecord(block)) continue;
      const type = historyBlockType(block);
      if (["thinking", "reasoning"].includes(type)) {
        pending = mergeActivity(pending, { id: `thinking:${index}`, sessionKey, kind: "thinking", title: "Thinking", detail: "Reasoned through the request", state: "done" });
      }
      if (["toolcall", "tooluse", "functioncall"].includes(type)) {
        const toolCallId = stringValue(block.toolCallId) ?? stringValue(block.tool_call_id) ?? stringValue(block.callId) ?? stringValue(block.id);
        const name = stringValue(block.name) ?? stringValue(block.toolName) ?? stringValue(block.tool_name) ?? "tool";
        if (toolCallId) toolNames.set(toolCallId, name);
        const activity = activityForTool({ ...block, name, status: "running" }, sessionKey);
        if (activity) pending = mergeActivity(pending, activity);
      }
    }

    if (["tool", "toolresult", "function"].includes(role) || blocks.some((block) => ["toolresult", "tooloutput", "functionresult"].includes(historyBlockType(block)))) {
      const resultBlock = blocks.find((block) => ["toolresult", "tooloutput", "functionresult"].includes(historyBlockType(block)) && isRecord(block));
      const source = isRecord(resultBlock) ? resultBlock : candidate;
      const toolCallId = stringValue(source.toolCallId) ?? stringValue(source.tool_call_id) ?? stringValue(source.callId) ?? stringValue(candidate.toolCallId) ?? stringValue(candidate.tool_call_id);
      const name = stringValue(source.name) ?? stringValue(source.toolName) ?? (toolCallId ? toolNames.get(toolCallId) : undefined) ?? "tool";
      const output = nestedActivityText(source.content ?? candidate.content, 12_000);
      const activity = activityForTool({ ...source, id: toolCallId, name, output, status: candidate.isError === true || source.isError === true ? "error" : "completed" }, sessionKey);
      if (activity) pending = mergeActivity(pending, activity);
      return;
    }

    const normalized = normalizeMessage(candidate, `${sessionKey}:${index}`);
    if (normalizedMessagePhase(candidate) === "final_answer") {
      for (const message of normalized) if (message.role === "assistant") finalAnswerIds.add(message.id);
    }
    const commentary = role === "assistant" ? assistantCommentaryText(candidate).trim() : "";
    if (commentary) {
      pending = mergeActivity(pending, {
        id: `thinking:${stringValue(candidate.id) ?? index}`,
        sessionKey,
        kind: "thinking",
        title: "Progress update",
        detail: safeActivityText(commentary, 2_400),
        state: "done",
      });
    }
    if (role === "assistant" && normalizedMessagePhase(candidate) === "commentary") {
      return;
    }
    for (const message of normalized) {
      const hasToolCall = blocks.some((block) => ["toolcall", "tooluse", "functioncall"].includes(historyBlockType(block)));
      if (message.role === "assistant" && !hasToolCall && pending.length) {
        message.activities = pending.map((activity) => ({ ...activity, state: activity.state === "running" ? "done" : activity.state }));
        pending = [];
      }
      messages.push(message);
    }
  });
  flushPending();
  const folded = foldAssistantProgress(messages, sessionKey);
  if (!options.hideUnfinishedTail) return folded;

  const lastUserIndex = folded.findLastIndex((message) => message.role === "user");
  const tail = folded.slice(lastUserIndex + 1);
  if (tail.some((message) => message.role === "assistant" && finalAnswerIds.has(message.id))) return folded;

  const activities: NeuraActivity[] = [];
  for (const message of tail) {
    if (message.role !== "assistant") continue;
    activities.push(...(message.activities ?? []));
    if (message.text.trim()) activities.push({
      id: `thinking:${message.id}`,
      sessionKey,
      kind: "thinking",
      title: "Progress update",
      detail: safeActivityText(message.text, 2_400),
      state: "done",
    });
  }
  if (!activities.length) return folded;
  return [
    ...folded.slice(0, lastUserIndex + 1),
    ...tail.filter((message) => message.role !== "assistant"),
    { id: `${sessionKey}:active-work`, role: "assistant", text: "", activities },
  ];
}

export function eventRecord(event: GatewayEvent): RecordValue | null {
  return isRecord(event.payload) ? event.payload : null;
}

export function assistantMessageContent(value: unknown): Pick<NeuraMessage, "text" | "attachments"> {
  if (!isRecord(value) || normalizedMessagePhase(value) === "commentary") return { text: "" };
  const message = normalizeMessage({ ...value, role: "assistant" }, "final")[0];
  return { text: message?.text ?? "", ...(message?.attachments ? { attachments: message.attachments } : {}) };
}

export function messagesFromSessionEvent(event: GatewayEvent) {
  const payload = eventRecord(event);
  if (event.event !== "session.message" || !payload) return null;
  const sessionKey = stringValue(payload.sessionKey);
  if (!sessionKey) return null;
  const runId = stringValue(payload.clientRunId) ?? stringValue(payload.runId);
  const sequence = numberValue(payload.messageSeq);
  const fallbackId = stringValue(payload.messageId) ?? `${sessionKey}:${sequence ?? crypto.randomUUID()}`;
  return {
    sessionKey,
    runId,
    phase: stringValue(payload.phase),
    messagePhase: normalizedMessagePhase(payload.message),
    commentaryText: assistantCommentaryText(payload.message).trim(),
    commentaryId: fallbackId,
    messages: normalizeMessage(payload.message, fallbackId),
  };
}

// Native typed plan items carry this marker in the durable text signature.
// User-written tags and ordinary task-progress updates do not create plan actions.
function isProposedPlanBlock(value: unknown): boolean {
  if (!isRecord(value) || value.type !== "text" || typeof value.textSignature !== "string") return false;
  try {
    const signature: unknown = JSON.parse(value.textSignature);
    return isRecord(signature) && signature.v === 1 && signature.proposedPlan === true && signature.phase === "final_answer";
  } catch { return false; }
}

export type NeuraQuestion = {
  id: string;
  sessionKey: string;
  expiresAtMs: number;
  questions: Array<{ questionId: string; header: string; question: string; options: Array<{ label: string; description?: string }>; multiSelect: boolean; isOther: boolean; isSecret: boolean }>;
};

export function normalizeNeuraQuestion(value: unknown, sessionKey: string, agentId: string): NeuraQuestion[] {
  if (!isRecord(value) || value.sessionKey !== sessionKey || value.agentId !== agentId || value.status !== "pending"
    || typeof value.id !== "string" || typeof value.expiresAtMs !== "number" || value.expiresAtMs <= Date.now() || !Array.isArray(value.questions)) return [];
  const questions: NeuraQuestion["questions"] = [];
  for (const question of value.questions) {
    if (!isRecord(question) || typeof question.questionId !== "string" || typeof question.question !== "string" || typeof question.header !== "string" || !Array.isArray(question.options) || question.secretStore) return [];
    const options = question.options.flatMap((option) => isRecord(option) && typeof option.label === "string"
      ? [{ label: option.label, ...(typeof option.description === "string" ? { description: option.description } : {}) }] : []);
    questions.push({ questionId: question.questionId, header: question.header, question: question.question, options, multiSelect: question.multiSelect === true, isOther: question.isOther === true || options.length === 0, isSecret: question.isSecret === true });
  }
  return questions.length ? [{ id: value.id, sessionKey, expiresAtMs: value.expiresAtMs, questions }] : [];
}
