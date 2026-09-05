import {
  Archive,
  ArchiveRestore,
  AudioWaveform,
  Check,
  ChevronDown,
  Globe2,
  Hash,
  Menu,
  LockKeyhole,
  ListOrdered,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  Plus,
  Send,
  Square,
  TerminalSquare,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { type ChangeEvent, type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useAppViewport } from "./appViewport";
import { activitiesFromGatewayEvent, eventRecord, eventText, messagesFromSessionEvent, NeuraGateway } from "./openclaw";
import { readDeviceState, writeDeviceState } from "./deviceState";
import { createWorkspaceFolder, uploadWorkspaceFile, workspaceContentUrl, workspaceDownloadUrl, type WorkspacePreviewFile } from "./filesApi";
import { listCustomSkills } from "./skillsApi";
import { teamChatApi, teamSocketUrl, type TeamAttachment, type TeamChannel, type TeamDirectoryUser, type TeamMessage } from "./teamChat";
import { listTerminals, type TerminalDescriptor } from "./terminalApi";
import { exchangeRealtimeOffer, supportedRecorderMimeType, transcribeVoiceMemo, voiceMemoExtension } from "./voiceApi";
import type {
  ComposerAttachment,
  ConnectionState,
  GatewayEvent,
  NeuraActivity,
  NeuraApproval,
  NeuraMessage,
  NeuraAttachment,
  SessionRow,
} from "./types";

type Props = {
  gateway: NeuraGateway;
  notify: (message: string) => void;
  active?: boolean;
  storageNamespace?: string;
  storageArea?: string;
  composeRequest?: { id: string; text: string };
  csrfToken?: string;
  currentUser?: { id: string; handle: string; displayName: string; role: "admin" | "user" };
  onPreviewFile?: (file: WorkspacePreviewFile) => void;
  onOpenTeamTerminal?: (channel: Pick<TeamChannel, "id" | "name">, session?: TerminalDescriptor) => Promise<TerminalDescriptor | undefined> | TerminalDescriptor | undefined;
};

type NeuraDeviceState = { selectedKey?: string; selectedChannelId?: string; freshStartForActivityAt?: number; sidebarOpen: boolean; terminalSidebarOpen: boolean; showArchived: boolean };
type SkillSuggestion = { key: string; name: string; description: string };
type SkillTrigger = { start: number; end: number; query: string };
type TeamAgentPhase = "starting" | "working";
type PrivateVoiceState = "idle" | "connecting" | "live";
type TeamVoiceState = "idle" | "recording" | "transcribing" | "sending";
type QueuedPrompt = {
  id: string;
  sessionKey: string;
  runId?: string;
  text: string;
  attachments: Array<{ name: string; type: string }>;
  status: "sending" | "queued";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function skillSuggestionsFromStatus(status: unknown): SkillSuggestion[] {
  const rows = isRecord(status) && Array.isArray(status.skills) ? status.skills : [];
  return rows.flatMap((candidate): SkillSuggestion[] => {
    if (!isRecord(candidate) || candidate.disabled === true || candidate.eligible !== true) return [];
    if (candidate.modelVisible !== true && candidate.userInvocable === false) return [];
    const key = recordString(candidate, "skillKey") ?? recordString(candidate, "name");
    if (!key) return [];
    return [{
      key,
      name: recordString(candidate, "name") ?? key,
      description: recordString(candidate, "description") ?? "OpenClaw skill",
    }];
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function skillTriggerAt(value: string, caret: number): SkillTrigger | null {
  const beforeCaret = value.slice(0, caret);
  const match = beforeCaret.match(/\$([A-Za-z0-9_-]*)$/);
  if (!match) return null;
  const start = caret - match[0].length;
  const preceding = start > 0 ? value[start - 1] : "";
  if (preceding && !/[\s([{:;,]/.test(preceding)) return null;
  return { start, end: caret, query: match[1] };
}

function skillCommand(skill: SkillSuggestion): string {
  return `$${skill.key}`;
}

function matchingSkillSuggestions(skills: SkillSuggestion[], trigger: SkillTrigger | null): SkillSuggestion[] {
  if (!trigger) return [];
  const query = trigger.query.toLowerCase().replaceAll("_", "-");
  return skills
    .filter((skill) => !query || `${skill.key} ${skill.name}`.toLowerCase().replaceAll("_", "-").includes(query))
    .sort((left, right) => {
      const leftStarts = left.key.toLowerCase().startsWith(query) || left.name.toLowerCase().startsWith(query);
      const rightStarts = right.key.toLowerCase().startsWith(query) || right.name.toLowerCase().startsWith(query);
      return Number(rightStarts) - Number(leftStarts) || left.name.localeCompare(right.name);
    })
    .slice(0, 10);
}

function neuraDeviceState(storageNamespace: string | undefined, storageArea: string): NeuraDeviceState {
  const stored = readDeviceState(storageNamespace, storageArea);
  if (!stored || typeof stored !== "object") return { sidebarOpen: true, terminalSidebarOpen: false, showArchived: false };
  const value = stored as Record<string, unknown>;
  return {
    selectedKey: typeof value.selectedKey === "string" ? value.selectedKey.slice(0, 500) : undefined,
    selectedChannelId: typeof value.selectedChannelId === "string" ? value.selectedChannelId.slice(0, 100) : undefined,
    freshStartForActivityAt: typeof value.freshStartForActivityAt === "number" && Number.isFinite(value.freshStartForActivityAt)
      ? value.freshStartForActivityAt
      : undefined,
    sidebarOpen: value.sidebarOpen !== false,
    terminalSidebarOpen: value.terminalSidebarOpen === true,
    showArchived: value.showArchived === true,
  };
}

export const NEURA_FRESH_START_AFTER_MS = 3 * 60 * 60 * 1_000;

export function staleChatActivityForFreshStart(
  sessions: SessionRow[],
  handledActivityAt: number | undefined,
  now = Date.now(),
): number | undefined {
  const available = sessions.filter((session) => !session.archived);
  if (available.some((session) => session.active)) return undefined;
  const latestActivityAt = available.reduce<number | undefined>(
    (latest, session) => latest === undefined || session.updatedAt > latest ? session.updatedAt : latest,
    undefined,
  );
  if (latestActivityAt === undefined || latestActivityAt === handledActivityAt) return undefined;
  return now - latestActivityAt >= NEURA_FRESH_START_AFTER_MS ? latestActivityAt : undefined;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return format.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, "hour");
  return format.format(Math.round(hours / 24), "day");
}

function recordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

const LOOPBACK_PREVIEW_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function websiteEntryFromMessage(message: string): { root: string; entry: string } | undefined {
  const withoutUrls = message.replace(/https?:\/\/[^\s<>)\]]+/gi, "");
  const matches = withoutUrls.matchAll(/\b([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/index\.html)\b/gi);
  let website: { root: string; entry: string } | undefined;
  for (const match of matches) {
    const path = match[1];
    const separator = path.lastIndexOf("/");
    website = { root: path.slice(0, separator), entry: path.slice(separator + 1) };
  }
  return website;
}

export function resolveNeuraMessageLink(href: string | undefined, _message: string): string | undefined {
  if (!href) return href;
  const path = workspacePathFromMessageReference(href);
  return path ? workspaceDownloadUrl(path) : href;
}

function workspacePathFromMessageReference(reference: string | undefined): string | undefined {
  if (!reference || reference.startsWith("#") || reference.includes("\\")) return undefined;
  const withoutSuffix = reference.split(/[?#]/, 1)[0] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutSuffix);
  } catch {
    return undefined;
  }
  const workspacePrefix = "/home/node/workspace/";
  const candidate = (decoded.startsWith(workspacePrefix) ? decoded.slice(workspacePrefix.length) : decoded).replace(/^\.\//, "");
  if (!candidate || candidate.startsWith("/") || candidate.includes(":")) return undefined;
  const segments = candidate.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return undefined;
  if (!/\.[A-Za-z0-9]{1,12}$/.test(segments.at(-1) ?? "")) return undefined;
  return candidate;
}

export function resolveNeuraMessageImage(src: string | undefined): string | undefined {
  const path = workspacePathFromMessageReference(src);
  return path ? workspaceContentUrl(path) : src;
}

function decodedLegacyPreviewRoot(token: string): string | undefined {
  if (token === "root") return "";
  try {
    const standard = token.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(token.length / 4) * 4, "=");
    const binary = atob(standard);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

export function neuraWebsitePreviewFile(href: string | undefined, message: string): WorkspacePreviewFile | undefined {
  if (!href) return undefined;
  let path: string | undefined;
  let url: URL;
  try {
    url = new URL(href, "https://neural-labs.invalid");
  } catch {
    return undefined;
  }
  if (["http:", "https:"].includes(url.protocol) && LOOPBACK_PREVIEW_HOSTS.has(url.hostname)) {
    const website = websiteEntryFromMessage(message);
    if (website) {
      const requestedEntry = decodeURIComponent(url.pathname).replace(/^\/+/, "") || website.entry;
      path = `${website.root}/${requestedEntry}`;
    }
  } else {
    const legacy = url.pathname.match(/^\/workspace\/preview\/([A-Za-z0-9_-]+)\/(.+)$/);
    const trustedLegacyHost = href.startsWith("/workspace/preview/")
      || url.hostname === "neural-labs.ai"
      || (typeof window !== "undefined" && url.origin === window.location.origin);
    if (legacy && trustedLegacyHost) {
      const root = decodedLegacyPreviewRoot(legacy[1]);
      if (root !== undefined) path = root ? `${root}/${decodeURIComponent(legacy[2])}` : decodeURIComponent(legacy[2]);
    } else {
      path = workspacePathFromMessageReference(href);
    }
  }
  const safePath = workspacePathFromMessageReference(path);
  if (!safePath || !/\.html?$/i.test(safePath)) return undefined;
  return {
    name: safePath.split("/").at(-1) ?? "index.html",
    path: safePath,
    size: 0,
    mimeType: "text/html",
  };
}

function isImageAttachment(attachment: Pick<NeuraAttachment, "name" | "type">): boolean {
  return attachment.type.toLowerCase().startsWith("image/") || /\.(?:avif|bmp|gif|jpe?g|png|webp)$/i.test(attachment.name);
}

function isAudioAttachment(attachment: Pick<NeuraAttachment, "name" | "type">): boolean {
  return attachment.type.toLowerCase().startsWith("audio/") || /\.(?:m4a|mp3|oga|ogg|wav|webm)$/i.test(attachment.name);
}

function attachmentSize(size: number | undefined): string {
  if (size === undefined) return "Workspace file";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function MessageAttachments({ attachments: items, className = "message-attachments" }: {
  attachments: Array<NeuraAttachment | TeamAttachment>;
  className?: string;
}) {
  return <div className={className}>{items.map((attachment, index) => {
    const path = "path" in attachment ? attachment.path : undefined;
    const directUrl = "url" in attachment ? attachment.url : undefined;
    const downloadUrl = path ? workspaceDownloadUrl(path) : directUrl;
    const imageUrl = isImageAttachment({ name: attachment.name, type: attachment.type ?? "" })
      ? path ? workspaceContentUrl(path) : directUrl
      : undefined;
    const audioUrl = isAudioAttachment({ name: attachment.name, type: attachment.type ?? "" })
      ? path ? workspaceContentUrl(path) : directUrl
      : undefined;
    const content = <>
      {imageUrl ? <img src={imageUrl} alt={attachment.name} loading="lazy" /> : audioUrl ? <audio controls preload="metadata" src={audioUrl} /> : <Paperclip />}
      <span className="attachment-copy"><strong>{attachment.name}</strong><small>{attachmentSize(attachment.size)}</small></span>
    </>;
    const key = `${path ?? directUrl ?? attachment.name}:${index}`;
    return downloadUrl
      ? audioUrl
        ? <div className="attachment-card attachment-audio" key={key}>{content}<a href={downloadUrl} download={path ? attachment.name : undefined}>Download</a></div>
        : <a className={imageUrl ? "attachment-card attachment-image" : "attachment-card"} key={key} href={downloadUrl} download={path ? attachment.name : undefined}>{content}</a>
      : <div className="attachment-card" key={key}>{content}</div>;
  })}</div>;
}

function approvalFromEvent(event: GatewayEvent): NeuraApproval | null {
  const payload = eventRecord(event);
  if (!payload || payload.phase === "terminal") return null;
  const raw = payload.approval && typeof payload.approval === "object" ? payload.approval as Record<string, unknown> : payload;
  const id = recordString(raw, "id") ?? recordString(payload, "id");
  const presentation = raw.presentation && typeof raw.presentation === "object"
    ? raw.presentation as Record<string, unknown>
    : {};
  const kind = recordString(presentation, "kind") ?? recordString(raw, "kind");
  if (!id || !kind || !["exec", "plugin", "system-agent"].includes(kind)) return null;
  const decisions = Array.isArray(presentation.allowedDecisions)
    ? presentation.allowedDecisions.filter((value): value is NeuraApproval["decisions"][number] =>
        ["allow-once", "allow-always", "deny"].includes(String(value)))
    : ["allow-once", "deny"] as NeuraApproval["decisions"];
  return {
    id,
    sessionKey: recordString(raw, "sourceSessionKey") ?? recordString(payload, "sessionKey"),
    kind: kind as NeuraApproval["kind"],
    title: recordString(presentation, "title") ?? (kind === "exec" ? "Run this command?" : "Approval required"),
    detail:
      recordString(presentation, "commandText") ??
      recordString(presentation, "description") ??
      recordString(presentation, "detail") ??
      "Neura needs your approval to continue.",
    decisions,
  };
}

function mergeHistoryWithLive(history: NeuraMessage[], live: NeuraMessage[]): NeuraMessage[] {
  const merged = [...history];
  const ids = new Set(history.map((message) => message.id));
  for (const message of live) {
    if (ids.has(message.id)) continue;
    const duplicateIndex = (message.id.startsWith("local:") || message.id.startsWith("run:"))
      ? merged.findIndex((persisted) => persisted.role === message.role && persisted.text === message.text)
      : -1;
    const optimisticDuplicate = duplicateIndex >= 0;
    if (optimisticDuplicate && message.attachments?.length && !merged[duplicateIndex].attachments?.length) {
      merged[duplicateIndex] = { ...merged[duplicateIndex], attachments: message.attachments };
    }
    if (!optimisticDuplicate) merged.push(message);
  }
  return merged;
}

function reconcilePersistedMessage(current: NeuraMessage[], message: NeuraMessage, runId?: string): NeuraMessage[] {
  const transient = runId && message.role === "assistant" ? current.find((candidate) => candidate.id === `run:${runId}`) : undefined;
  const optimisticUser = message.role === "user" ? current.find((candidate) => candidate.role === "user" && candidate.id.startsWith("local:") && candidate.text === message.text) : undefined;
  let persisted = transient?.activities?.length && !message.activities?.length ? { ...message, activities: transient.activities } : message;
  if (optimisticUser?.attachments?.length && !persisted.attachments?.length) persisted = { ...persisted, attachments: optimisticUser.attachments };
  let optimisticUserRemoved = false;
  const next = current.filter((candidate) => {
    if (candidate.id === persisted.id) return false;
    if (runId && persisted.role === "assistant" && candidate.id === `run:${runId}`) return false;
    if (!optimisticUserRemoved && persisted.role === "user" && candidate.role === "user" && candidate.id.startsWith("local:") && candidate.text === persisted.text) {
      optimisticUserRemoved = true;
      return false;
    }
    return true;
  });
  return [...next, persisted];
}

function isTranscriptAtBottom(element: HTMLElement, threshold = 48): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

const unavailableTeamUser = { id: "", handle: "user", displayName: "User", role: "user" as const };

export function teamMessagePresentation(
  message: Pick<TeamMessage, "authorKind" | "author">,
  currentUserId: string,
): "assistant" | "system" | "user" | "teammate" {
  if (message.authorKind === "neura" || message.authorKind === "imported_neura") return "assistant";
  if (message.authorKind === "system") return "system";
  return message.author?.id === currentUserId ? "user" : "teammate";
}

export function teamAgentPhaseFromStatus(status: unknown): TeamAgentPhase | undefined {
  return status === "queued" ? "starting" : status === "running" ? "working" : undefined;
}

export function invokesTeamAgent(body: string): boolean {
  return /(?:^|[\s([{:;,])@neura\b/i.test(body)
    || /(?:^|[\s([{:;,])\$(?!neura\b)[A-Za-z][A-Za-z0-9_-]*\b/i.test(body);
}

export function modelProviderErrorMessage(rawError: string): string {
  if (/missing bearer|missing basic authentication/i.test(rawError)) {
    return "Neura couldn't activate your ChatGPT connection. Open Personalization and try Resume; reconnect if the problem continues.";
  }
  if (/401|authentication|unauthorized|invalid.{0,20}(token|credential)|expired.{0,20}(token|credential)/i.test(rawError)) {
    return "Your ChatGPT sign-in was rejected or expired. Reconnect it in Personalization, then try again.";
  }
  return rawError;
}

export function NeuraApp({ gateway, notify, active = true, storageNamespace, storageArea = "neura", composeRequest, csrfToken = "", currentUser = unavailableTeamUser, onPreviewFile, onOpenTeamTerminal }: Props) {
  const appViewport = useAppViewport();
  const [initialUiState] = useState(() => neuraDeviceState(storageNamespace, storageArea));
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [connectionError, setConnectionError] = useState<string>();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | undefined>(initialUiState.selectedKey);
  const [selectedChannelId, setSelectedChannelId] = useState<string | undefined>(initialUiState.selectedChannelId);
  const [freshStartForActivityAt, setFreshStartForActivityAt] = useState<number | undefined>(initialUiState.freshStartForActivityAt);
  const [teamChannels, setTeamChannels] = useState<TeamChannel[]>([]);
  const [teamDirectory, setTeamDirectory] = useState<TeamDirectoryUser[]>([]);
  const [teamMessages, setTeamMessages] = useState<TeamMessage[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamDirectoryUser[]>([]);
  const [teamConnection, setTeamConnection] = useState<ConnectionState>("connecting");
  const [teamAgentPhase, setTeamAgentPhase] = useState<TeamAgentPhase>();
  const [teamAgentError, setTeamAgentError] = useState<string>();
  const [teamTyping, setTeamTyping] = useState<TeamDirectoryUser[]>([]);
  const [teamDraft, setTeamDraft] = useState("");
  const [teamAttachments, setTeamAttachments] = useState<TeamAttachment[]>([]);
  const [privateVoiceState, setPrivateVoiceState] = useState<PrivateVoiceState>("idle");
  const [teamVoiceState, setTeamVoiceState] = useState<TeamVoiceState>("idle");
  const [teamVoiceSeconds, setTeamVoiceSeconds] = useState(0);
  const [teamDialog, setTeamDialog] = useState<{ source?: SessionRow } | undefined>();
  const [manageChannel, setManageChannel] = useState<TeamChannel | undefined>();
  const [teamTerminalOpening, setTeamTerminalOpening] = useState(false);
  const [teamTerminals, setTeamTerminals] = useState<TerminalDescriptor[]>([]);
  const [teamTerminalsLoading, setTeamTerminalsLoading] = useState(false);
  const [teamTerminalsError, setTeamTerminalsError] = useState<string>();
  const [messages, setMessages] = useState<NeuraMessage[]>([]);
  const [activities, setActivities] = useState<NeuraActivity[]>([]);
  const [approvals, setApprovals] = useState<NeuraApproval[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [runId, setRunId] = useState<string>();
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
  const [composerSubmitting, setComposerSubmitting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(initialUiState.sidebarOpen);
  const [terminalSidebarOpen, setTerminalSidebarOpen] = useState(initialUiState.terminalSidebarOpen);
  const [mobileDrawer, setMobileDrawer] = useState(false);
  const [showArchived, setShowArchived] = useState(initialUiState.showArchived);
  const [creatingSession, setCreatingSession] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [skills, setSkills] = useState<SkillSuggestion[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillTrigger, setSkillTrigger] = useState<SkillTrigger | null>(null);
  const [skillMenuIndex, setSkillMenuIndex] = useState(0);
  const [teamSkillTrigger, setTeamSkillTrigger] = useState<SkillTrigger | null>(null);
  const [teamSkillMenuIndex, setTeamSkillMenuIndex] = useState(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const selectedKeyRef = useRef(selectedKey);
  const subscribedKeyRef = useRef<string | undefined>(undefined);
  const sessionsRequestRef = useRef(0);
  const initialSessionRefreshPending = useRef(true);
  const wasActive = useRef(active);
  const freshStartForActivityAtRef = useRef(freshStartForActivityAt);
  const messageScroll = useRef<HTMLDivElement>(null);
  const messageContent = useRef<HTMLDivElement>(null);
  const transcriptPinnedToBottom = useRef(true);
  const transcriptFollowFrame = useRef<number | undefined>(undefined);
  const activitiesRef = useRef<NeuraActivity[]>([]);
  const pendingAssistantText = useRef(new Map<string, string>());
  const progressSequence = useRef(0);
  const runIdRef = useRef(runId);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachmentObjectUrls = useRef(new Set<string>());
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const teamComposerInput = useRef<HTMLTextAreaElement>(null);
  const teamFileInput = useRef<HTMLInputElement>(null);
  const teamSocket = useRef<WebSocket | undefined>(undefined);
  const teamReconnect = useRef<number | undefined>(undefined);
  const teamTypingTimer = useRef<number | undefined>(undefined);
  const privateVoicePeer = useRef<RTCPeerConnection | undefined>(undefined);
  const privateVoiceStream = useRef<MediaStream | undefined>(undefined);
  const privateVoiceTimer = useRef<number | undefined>(undefined);
  const privateVoiceAudio = useRef<HTMLAudioElement | undefined>(undefined);
  const teamVoiceRecorder = useRef<MediaRecorder | undefined>(undefined);
  const teamVoiceStream = useRef<MediaStream | undefined>(undefined);
  const teamVoiceChunks = useRef<Blob[]>([]);
  const teamVoiceTimer = useRef<number | undefined>(undefined);
  const teamVoiceStartedAt = useRef(0);
  const selectedChannelRef = useRef(selectedChannelId);
  const lastComposeRequest = useRef<string | undefined>(undefined);
  const queuedPromptsRef = useRef<QueuedPrompt[]>([]);
  const composerSubmittingRef = useRef(false);
  const selected = sessions.find((session) => session.key === selectedKey);
  const selectedChannel = teamChannels.find((channel) => channel.id === selectedChannelId);
  const agentBusy = Boolean(runId || selected?.active);
  const sessionQueue = queuedPrompts.filter((prompt) => prompt.sessionKey === selectedKey);

  const stopPrivateVoice = useCallback(() => {
    if (privateVoiceTimer.current) window.clearTimeout(privateVoiceTimer.current);
    privateVoiceTimer.current = undefined;
    privateVoicePeer.current?.close();
    privateVoiceStream.current?.getTracks().forEach((track) => track.stop());
    if (privateVoiceAudio.current) privateVoiceAudio.current.srcObject = null;
    privateVoicePeer.current = undefined;
    privateVoiceStream.current = undefined;
    privateVoiceAudio.current = undefined;
    setPrivateVoiceState("idle");
  }, []);

  const togglePrivateVoice = async () => {
    if (privateVoiceState !== "idle") {
      stopPrivateVoice();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      notify("This browser does not support Neura voice chat.");
      return;
    }
    setPrivateVoiceState("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      privateVoiceStream.current = stream;
      const peer = new RTCPeerConnection();
      privateVoicePeer.current = peer;
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      const audio = document.createElement("audio");
      audio.autoplay = true;
      privateVoiceAudio.current = audio;
      peer.ontrack = (event) => { audio.srcObject = event.streams[0] ?? null; };
      peer.onconnectionstatechange = () => {
        if (["failed", "closed", "disconnected"].includes(peer.connectionState)) stopPrivateVoice();
      };
      const events = peer.createDataChannel("oai-events");
      events.addEventListener("open", () => events.send(JSON.stringify({
        type: "response.create",
        response: { instructions: "Greet the user briefly as Neura, then ask how you can help." },
      })));
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const { answer, maxSeconds } = await exchangeRealtimeOffer(offer.sdp ?? "");
      await peer.setRemoteDescription({ type: "answer", sdp: answer });
      setPrivateVoiceState("live");
      privateVoiceTimer.current = window.setTimeout(() => {
        stopPrivateVoice();
        notify("The five-minute Neura voice session has ended.");
      }, maxSeconds * 1_000);
    } catch (error) {
      stopPrivateVoice();
      notify(error instanceof Error ? error.message : "Could not start Neura voice. Check microphone access and try again.");
    }
  };

  selectedKeyRef.current = selectedKey;
  selectedChannelRef.current = selectedChannelId;
  runIdRef.current = runId;
  freshStartForActivityAtRef.current = freshStartForActivityAt;

  const updateQueuedPrompts = (update: (current: QueuedPrompt[]) => QueuedPrompt[]) => {
    const next = update(queuedPromptsRef.current);
    queuedPromptsRef.current = next;
    setQueuedPrompts(next);
  };

  const replaceActivities = (next: NeuraActivity[]) => {
    activitiesRef.current = next;
    setActivities(next);
  };

  const updateActivities = (incoming: NeuraActivity[]) => {
    if (!incoming.length) return;
    let next = activitiesRef.current;
    for (const activity of incoming) {
      const previous = next.find((item) => item.id === activity.id);
      next = [...next.filter((item) => item.id !== activity.id), { ...previous, ...activity }].slice(-80);
    }
    replaceActivities(next);
  };

  const foldPendingAssistantText = (sessionKey: string, activityRunId: string | undefined, incoming: NeuraActivity[]): NeuraActivity[] => {
    if (!activityRunId || !incoming.length) return incoming;
    const text = pendingAssistantText.current.get(activityRunId)?.trim();
    if (!text) return incoming;
    pendingAssistantText.current.delete(activityRunId);
    setMessages((current) => current.filter((message) => message.id !== `run:${activityRunId}`));
    if (incoming.some((activity) => activity.title === "Progress update" && activity.detail?.trim() === text)) return incoming;
    progressSequence.current += 1;
    return [{
      id: `thinking:preamble:${activityRunId}:${progressSequence.current}`,
      sessionKey,
      runId: activityRunId,
      kind: "thinking",
      title: "Progress update",
      detail: text.slice(0, 2_400),
      state: "done",
    }, ...incoming];
  };

  const finishRunActivities = (completedRunId: string, failed = false): NeuraActivity[] => {
    const matching = activitiesRef.current.filter((activity) => !activity.runId || activity.runId === completedRunId);
    const completed = matching.map((activity) => ({
      ...activity,
      state: activity.state === "running" ? failed ? "error" as const : "done" as const : activity.state,
    }));
    replaceActivities(activitiesRef.current.filter((activity) => activity.runId && activity.runId !== completedRunId));
    return completed;
  };

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "auto") => {
    const element = messageScroll.current;
    if (!element) return;
    transcriptPinnedToBottom.current = true;
    setShowJumpToLatest(false);
    if (behavior === "smooth" && element.scrollTo) element.scrollTo({ top: element.scrollHeight, behavior });
    else element.scrollTop = element.scrollHeight;
  }, []);

  const handleTranscriptScroll = () => {
    const element = messageScroll.current;
    if (!element) return;
    const pinned = isTranscriptAtBottom(element);
    transcriptPinnedToBottom.current = pinned;
    setShowJumpToLatest(!pinned && element.scrollHeight > element.clientHeight + 48);
  };

  const promoteQueuedPrompt = (queuedRunId: string) => {
    const queued = queuedPromptsRef.current.find((prompt) => prompt.runId === queuedRunId);
    if (!queued) return;
    updateQueuedPrompts((current) => current.filter((prompt) => prompt.id !== queued.id));
    if (queued.sessionKey !== selectedKeyRef.current && queued.sessionKey !== subscribedKeyRef.current) return;
    setMessages((current) => current.some((message) => message.id === `local:queued:${queued.id}`)
      ? current
      : [...current, {
          id: `local:queued:${queued.id}`,
          role: "user",
          text: queued.text || queued.attachments.map((attachment) => attachment.name).join(", "),
          attachments: queued.attachments,
        }]);
  };

  useEffect(() => {
    if (!composeRequest || lastComposeRequest.current === composeRequest.id) return;
    lastComposeRequest.current = composeRequest.id;
    setDraft(composeRequest.text);
    setSkillTrigger(null);
    window.setTimeout(() => composerInput.current?.focus(), 0);
  }, [composeRequest]);

  const refreshSessions = async () => {
    const requestId = ++sessionsRequestRef.current;
    try {
      const listed = await gateway.listSessions();
      const next = (await gateway.protectLegacyPrivateSessions(listed))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      if (requestId !== sessionsRequestRef.current) return;
      setSessions(next);
      const idleSessionKeys = new Set(next.filter((session) => !session.active).map((session) => session.key));
      updateQueuedPrompts((current) => current.filter((prompt) => !idleSessionKeys.has(prompt.sessionKey)));
      const currentSession = next.find((session) => session.key === selectedKeyRef.current);
      if (currentSession && !currentSession.active) {
        runIdRef.current = undefined;
        setRunId(undefined);
      }
      if (initialSessionRefreshPending.current) {
        initialSessionRefreshPending.current = false;
        const staleActivityAt = staleChatActivityForFreshStart(next, freshStartForActivityAtRef.current);
        if (staleActivityAt !== undefined) {
          freshStartForActivityAtRef.current = staleActivityAt;
          setFreshStartForActivityAt(staleActivityAt);
          setSelectedChannelId(undefined);
          setSelectedKey(undefined);
          return;
        }
      }
      setSelectedKey((current) => selectedChannelRef.current
        ? undefined
        : current && next.some((session) => session.key === current)
          ? current
          : next.find((session) => !session.archived)?.key);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load Neura conversations");
    }
  };

  useEffect(() => {
    const removeStatus = gateway.onStatus((state, error) => {
      setConnection(state);
      setConnectionError(error);
      if (state === "connected") void refreshSessions();
    });
    const removeEvents = gateway.onEvent(handleGatewayEvent);
    return () => {
      removeStatus();
      removeEvents();
    };
  }, []);

  useEffect(() => {
    const becameActive = active && !wasActive.current;
    wasActive.current = active;
    if (!becameActive) return;
    const staleActivityAt = staleChatActivityForFreshStart(sessions, freshStartForActivityAtRef.current);
    if (staleActivityAt === undefined) return;
    freshStartForActivityAtRef.current = staleActivityAt;
    setFreshStartForActivityAt(staleActivityAt);
    setSelectedChannelId(undefined);
    setSelectedKey(undefined);
  }, [active, sessions]);

  const refreshTeamChannels = useCallback(async () => {
    try {
      const [channelResult, directoryResult] = await Promise.all([
        teamChatApi.channels(),
        teamChatApi.directory(),
      ]);
      setTeamChannels(channelResult.channels);
      setTeamDirectory(directoryResult.users);
      setSelectedChannelId((current) => current && channelResult.channels.some((channel) => channel.id === current) ? current : undefined);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load Team Chats");
    }
  }, [notify]);

  useEffect(() => {
    if (!csrfToken) {
      setTeamConnection("disconnected");
      return;
    }
    let active = true;
    let retry = 500;
    const connect = async () => {
      if (!active) return;
      setTeamConnection("connecting");
      try {
        const issued = await teamChatApi.ticket(csrfToken);
        if (!active) return;
        const socket = new WebSocket(teamSocketUrl(issued.ticket));
        teamSocket.current = socket;
        socket.onopen = () => {
          retry = 500;
          setTeamConnection("connected");
          if (selectedChannelRef.current) socket.send(JSON.stringify({ type: "subscribe", channelId: selectedChannelRef.current }));
        };
        socket.onmessage = (event) => {
          let value: Record<string, unknown>;
          try { value = JSON.parse(String(event.data)) as Record<string, unknown>; } catch { return; }
          if (value.type === "ready") {
            if (Array.isArray(value.channels)) setTeamChannels(value.channels as TeamChannel[]);
            if (Array.isArray(value.users)) setTeamDirectory(value.users as TeamDirectoryUser[]);
          } else if (value.type === "snapshot" && value.channelId === selectedChannelRef.current && Array.isArray(value.messages)) {
            setTeamMessages(value.messages as TeamMessage[]);
            const run = value.agentRun as { status?: string } | undefined;
            setTeamAgentPhase(teamAgentPhaseFromStatus(run?.status));
          } else if (value.type === "message.created" && value.channelId === selectedChannelRef.current && value.message) {
            const message = value.message as TeamMessage;
            setTeamMessages((current) => current.some((item) => item.id === message.id)
              ? current.map((item) => item.id === message.id ? message : item)
              : [...current, message]);
          } else if (value.type === "channels.changed") {
            void refreshTeamChannels();
          } else if (value.type === "agent.status" && value.channelId === selectedChannelRef.current) {
            const run = value.run as { status?: string; error?: string } | undefined;
            setTeamAgentPhase(teamAgentPhaseFromStatus(run?.status));
            if (run?.status === "queued" || run?.status === "running" || run?.status === "completed") setTeamAgentError(undefined);
            if (run?.status === "failed") setTeamAgentError(run.error ?? "Neura could not complete that Team Chat turn.");
          } else if (value.type === "typing" && value.channelId === selectedChannelRef.current && value.user) {
            const user = value.user as TeamDirectoryUser;
            setTeamTyping((current) => value.active === true
              ? [...current.filter((item) => item.id !== user.id), user]
              : current.filter((item) => item.id !== user.id));
          } else if (value.type === "membership.revoked" && value.channelId === selectedChannelRef.current) {
            setSelectedChannelId(undefined);
            setTeamMessages([]);
            notify("You no longer have access to that Team Chat.");
          } else if (value.type === "error" && typeof value.message === "string") {
            setTeamAgentPhase(undefined);
            notify(value.message);
          }
        };
        socket.onerror = () => setTeamConnection("error");
        socket.onclose = () => {
          if (teamSocket.current === socket) teamSocket.current = undefined;
          if (!active) return;
          setTeamConnection("disconnected");
          teamReconnect.current = window.setTimeout(() => void connect(), retry);
          retry = Math.min(retry * 2, 10_000);
        };
      } catch {
        if (!active) return;
        setTeamConnection("error");
        teamReconnect.current = window.setTimeout(() => void connect(), retry);
        retry = Math.min(retry * 2, 10_000);
      }
    };
    void connect();
    return () => {
      active = false;
      if (teamReconnect.current) window.clearTimeout(teamReconnect.current);
      teamSocket.current?.close();
      teamSocket.current = undefined;
    };
  }, [csrfToken, notify, refreshTeamChannels]);

  useEffect(() => {
    setTeamTyping([]);
    setTeamAgentPhase(undefined);
    if (!selectedChannelId) {
      setTeamMessages([]);
      setTeamMembers([]);
      return;
    }
    setMobileDrawer(false);
    const socket = teamSocket.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "subscribe", channelId: selectedChannelId }));
    } else {
      void teamChatApi.messages(selectedChannelId).then((result) => {
        if (selectedChannelRef.current === selectedChannelId) setTeamMessages(result.messages);
      }).catch((error) => notify(error instanceof Error ? error.message : "Could not load Team Chat messages"));
    }
    void teamChatApi.members(selectedChannelId)
      .then((result) => { if (selectedChannelRef.current === selectedChannelId) setTeamMembers(result.users); })
      .catch(() => setTeamMembers([]));
  }, [selectedChannelId, notify]);

  useEffect(() => {
    if (!selectedChannelId || teamMessages.length === 0) return;
    const sequence = teamMessages.at(-1)!.sequence;
    void teamChatApi.markRead(csrfToken, selectedChannelId, sequence).catch(() => undefined);
  }, [csrfToken, selectedChannelId, teamMessages]);

  useEffect(() => {
    if (!selectedChannelId) {
      setTeamTerminals([]);
      setTeamTerminalsError(undefined);
      setTeamTerminalsLoading(false);
      return;
    }
    let active = true;
    const refresh = async (initial = false) => {
      if (initial) setTeamTerminalsLoading(true);
      try {
        const sessions = await listTerminals();
        if (!active || selectedChannelRef.current !== selectedChannelId) return;
        setTeamTerminals(sessions
          .filter((session) => session.teamChannel?.id === selectedChannelId)
          .sort((left, right) => Number(right.status === "running") - Number(left.status === "running") || right.createdAt - left.createdAt));
        setTeamTerminalsError(undefined);
      } catch (error) {
        if (!active) return;
        setTeamTerminalsError(error instanceof Error ? error.message : "Channel terminals could not be loaded.");
      } finally {
        if (active && initial) setTeamTerminalsLoading(false);
      }
    };
    void refresh(true);
    const interval = window.setInterval(() => void refresh(), 4_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [selectedChannelId]);

  useEffect(() => {
    if (connection !== "connected") return;
    let active = true;
    setSkillsLoaded(false);
    void Promise.all([gateway.readSkillsStatus(), listCustomSkills().catch(() => [])])
      .then(([status, customSkills]) => {
        if (!active) return;
        const customByKey = new Map(customSkills.map((skill) => [skill.key, skill]));
        const visible = skillSuggestionsFromStatus(status).filter((skill) => {
          const custom = customByKey.get(skill.key);
          return !custom || custom.scope === "team" || custom.ownedByCurrentUser;
        });
        for (const custom of customSkills) {
          if (custom.scope !== "team" && !custom.ownedByCurrentUser || visible.some((skill) => skill.key === custom.key)) continue;
          visible.push({ key: custom.key, name: custom.name, description: custom.description });
        }
        setSkills(visible.sort((left, right) => left.name.localeCompare(right.name)));
        setSkillsLoaded(true);
      })
      .catch(() => {
        if (active) setSkillsLoaded(true);
      });
    return () => { active = false; };
  }, [connection, gateway]);

  useEffect(() => {
    setSessionReady(false);
    setMessages([]);
    replaceActivities([]);
    pendingAssistantText.current.clear();
    runIdRef.current = undefined;
    setRunId(undefined);
  }, [selectedChannelId, selectedKey]);

  useEffect(() => {
    if (initialSessionRefreshPending.current || !selectedKey || selectedChannelId || connection !== "connected") {
      setSessionReady(false);
      return;
    }
    let active = true;
    let subscription: Awaited<ReturnType<NeuraGateway["subscribeSession"]>> | undefined;
    setSessionReady(false);
    void (async () => {
      try {
        const acquired = await gateway.subscribeSession(selectedKey);
        if (!active) {
          await gateway.unsubscribeSession(acquired);
          return;
        }
        subscription = acquired;
        subscribedKeyRef.current = acquired.key;
        const history = await gateway.loadHistory(selectedKey);
        if (!active) return;
        setMessages((current) => mergeHistoryWithLive(history, current));
        setSessionReady(true);
      } catch (error) {
        if (active) notify(error instanceof Error ? error.message : "Could not connect this conversation to Neura");
      }
    })();
    setApprovals((current) => current.filter((approval) => !approval.sessionKey || approval.sessionKey === selectedKey));
    setMobileDrawer(false);
    return () => {
      active = false;
      subscribedKeyRef.current = undefined;
      if (subscription) void gateway.unsubscribeSession(subscription);
    };
  }, [selectedKey, selectedChannelId, connection]);

  useEffect(() => {
    transcriptPinnedToBottom.current = true;
    setShowJumpToLatest(false);
  }, [selectedKey, selectedChannelId]);

  useLayoutEffect(() => {
    if (!transcriptPinnedToBottom.current) return;
    scrollToLatest();
    if (transcriptFollowFrame.current !== undefined) cancelAnimationFrame(transcriptFollowFrame.current);
    transcriptFollowFrame.current = requestAnimationFrame(() => {
      transcriptFollowFrame.current = undefined;
      if (transcriptPinnedToBottom.current) scrollToLatest();
    });
  }, [activities, messages, scrollToLatest, selectedChannelId, selectedKey, teamAgentPhase, teamMessages]);

  useEffect(() => {
    const content = messageContent.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (transcriptPinnedToBottom.current) scrollToLatest();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToLatest, selectedChannelId, selectedKey]);

  useEffect(() => () => {
    if (transcriptFollowFrame.current !== undefined) cancelAnimationFrame(transcriptFollowFrame.current);
    for (const url of attachmentObjectUrls.current) URL.revokeObjectURL(url);
    attachmentObjectUrls.current.clear();
    if (privateVoiceTimer.current) window.clearTimeout(privateVoiceTimer.current);
    privateVoicePeer.current?.close();
    privateVoiceStream.current?.getTracks().forEach((track) => track.stop());
    if (teamVoiceTimer.current) window.clearInterval(teamVoiceTimer.current);
    const recorder = teamVoiceRecorder.current;
    if (recorder) recorder.onstop = null;
    if (recorder?.state === "recording") recorder.stop();
    teamVoiceStream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (selectedChannelId) stopPrivateVoice();
  }, [selectedChannelId, stopPrivateVoice]);

  useEffect(() => {
    writeDeviceState(storageNamespace, storageArea, { selectedKey, selectedChannelId, freshStartForActivityAt, sidebarOpen, terminalSidebarOpen, showArchived } satisfies NeuraDeviceState);
  }, [freshStartForActivityAt, selectedKey, selectedChannelId, showArchived, sidebarOpen, storageArea, storageNamespace, terminalSidebarOpen]);

  function handleGatewayEvent(event: GatewayEvent) {
    const payload = eventRecord(event);
    if (!payload) return;
    if (event.event === "chat" && ["status", "delta"].includes(recordString(payload, "state") ?? "")) {
      const queuedRunId = recordString(payload, "runId");
      if (queuedRunId) promoteQueuedPrompt(queuedRunId);
    }
    if (event.event === "sessions.changed") {
      void refreshSessions();
      return;
    }
    if (event.event === "session.approval") {
      const approval = approvalFromEvent(event);
      if (approval) setApprovals((current) => [...current.filter((item) => item.id !== approval.id), approval]);
      else if (recordString(payload, "id")) setApprovals((current) => current.filter((item) => item.id !== recordString(payload, "id")));
      return;
    }
    if (event.event === "session.message") {
      const persisted = messagesFromSessionEvent(event);
      if (!persisted || persisted.sessionKey !== selectedKeyRef.current && persisted.sessionKey !== subscribedKeyRef.current) return;
      if (persisted.messagePhase === "commentary") {
        if (persisted.runId) {
          runIdRef.current = persisted.runId;
          setRunId(persisted.runId);
          pendingAssistantText.current.delete(persisted.runId);
          setMessages((current) => current.filter((message) => message.id !== `run:${persisted.runId}`));
        }
        updateActivities(persisted.messages.flatMap((message): NeuraActivity[] => message.role === "assistant" && message.text.trim()
          ? [{
              id: `thinking:${message.id}`,
              sessionKey: persisted.sessionKey,
              runId: persisted.runId,
              kind: "thinking",
              title: "Progress update",
              detail: message.text.trim().slice(0, 2_400),
              state: "done",
            }]
          : []));
        return;
      }
      if (persisted.runId && persisted.messages.some((message) => message.role === "user")) promoteQueuedPrompt(persisted.runId);
      const runFinished = Boolean(persisted.runId && ["end", "error"].includes(persisted.phase ?? ""));
      if (runFinished) pendingAssistantText.current.delete(persisted.runId!);
      const completedActivities = runFinished ? finishRunActivities(persisted.runId!, persisted.phase === "error") : [];
      const finalAssistantIndex = persisted.messages.findLastIndex((message) => message.role === "assistant");
      for (const [index, message] of persisted.messages.entries()) {
        const enriched = index === finalAssistantIndex && completedActivities.length
          ? { ...message, activities: completedActivities }
          : message;
        setMessages((current) => reconcilePersistedMessage(current, enriched, persisted.runId));
      }
      if (persisted.messages.some((message) => message.attachments?.some((attachment) => attachment.artifactId))) {
        void gateway.resolveMessageAttachments(persisted.sessionKey, persisted.messages).then((resolved) => {
          if (persisted.sessionKey !== selectedKeyRef.current && persisted.sessionKey !== subscribedKeyRef.current) return;
          const byId = new Map(resolved.map((message) => [message.id, message.attachments]));
          setMessages((current) => current.map((message) => {
            const attachments = byId.get(message.id);
            return attachments ? { ...message, attachments } : message;
          }));
        }).catch(() => undefined);
      }
      if (runFinished && finalAssistantIndex < 0 && completedActivities.length) {
        setMessages((current) => [...current, { id: `activity:${persisted.runId}`, role: "assistant", text: "", activities: completedActivities }]);
      }
      if (persisted.runId && ["end", "error"].includes(persisted.phase ?? "")) {
        if (runIdRef.current === persisted.runId) runIdRef.current = undefined;
        setRunId((current) => current === persisted.runId ? undefined : current);
      }
      void refreshSessions();
      return;
    }
    const explicitSessionKey = recordString(payload, "sessionKey");
    const payloadRunId = recordString(payload, "runId");
    const currentRunEvent = event.event === "agent" && Boolean(payloadRunId && payloadRunId === runIdRef.current);
    if (explicitSessionKey && explicitSessionKey !== selectedKeyRef.current && explicitSessionKey !== subscribedKeyRef.current || !explicitSessionKey && !currentRunEvent) return;
    const sessionKey = explicitSessionKey ?? selectedKeyRef.current;
    if (!sessionKey) return;
    if (event.event === "chat") {
      const state = recordString(payload, "state");
      const eventRunId = recordString(payload, "runId") ?? "active";
      if (state === "status") {
        runIdRef.current = eventRunId;
        setRunId(eventRunId);
        if (activitiesRef.current.some((activity) => activity.runId && activity.runId !== eventRunId)) replaceActivities([]);
      }
      if (state === "delta") {
        runIdRef.current = eventRunId;
        setRunId(eventRunId);
        const delta = recordString(payload, "deltaText") ?? "";
        setMessages((current) => {
          const id = `run:${eventRunId}`;
          const existing = current.find((message) => message.id === id);
          const text = payload.replace === true ? delta : `${existing?.text ?? ""}${delta}`;
          pendingAssistantText.current.set(eventRunId, text);
          return [...current.filter((message) => message.id !== id), { ...existing, id, role: "assistant", text, pending: true }];
        });
      }
      if (["final", "aborted", "error"].includes(state ?? "")) {
        pendingAssistantText.current.delete(eventRunId);
        if (runIdRef.current === eventRunId) runIdRef.current = undefined;
        setRunId((current) => current === eventRunId ? undefined : current);
        const finalText = eventText(payload.message);
        const completedActivities = finishRunActivities(eventRunId, state === "error");
        setMessages((current) => {
          const id = `run:${eventRunId}`;
          if (!current.some((message) => message.id === id) && !finalText && completedActivities.length) {
            return [...current, { id, role: "assistant", text: state === "aborted" ? "Stopped." : "", pending: false, activities: completedActivities }];
          }
          if (!current.some((message) => message.id === id) && finalText) {
            const duplicate = current.find((message) => message.role === "assistant" && message.text === finalText);
            if (duplicate) return completedActivities.length
              ? current.map((message) => message.id === duplicate.id ? { ...message, activities: message.activities?.length ? message.activities : completedActivities } : message)
              : current;
            return [...current, { id, role: "assistant", text: finalText, pending: false, ...(completedActivities.length ? { activities: completedActivities } : {}) }];
          }
          return current.map((message) => message.id === id
            ? { ...message, text: finalText || message.text, pending: false, ...(completedActivities.length ? { activities: completedActivities } : {}) }
            : message);
        });
        if (state === "error") {
          const rawError = recordString(payload, "errorMessage") ?? "Neura could not finish that request";
          const displayError = modelProviderErrorMessage(rawError);
          setMessages((current) => current.some((message) => message.id === `error:${eventRunId}`)
            ? current
            : [...current, { id: `error:${eventRunId}`, role: "system", text: displayError }]);
          notify(displayError);
        }
        void refreshSessions();
      }
      return;
    }
    if (event.event === "session.tool" || event.event === "session.operation" || event.event === "agent") {
      const incoming = activitiesFromGatewayEvent(explicitSessionKey ? event : { ...event, payload: { ...payload, sessionKey } });
      updateActivities(foldPendingAssistantText(sessionKey, payloadRunId, incoming));
    }
  }

  const visibleSessions = useMemo(
    () => sessions.filter((session) => session.archived === showArchived),
    [sessions, showArchived],
  );
  const privateSessions = visibleSessions.filter((session) => session.visibility === "draft");
  const pinnedTeamChannels = teamChannels.filter((channel) => channel.pinned);
  const regularTeamChannels = teamChannels.filter((channel) => !channel.pinned);
  const matchingSkills = useMemo(() => matchingSkillSuggestions(skills, skillTrigger), [skillTrigger, skills]);
  const matchingTeamSkills = useMemo(() => matchingSkillSuggestions(skills, teamSkillTrigger), [skills, teamSkillTrigger]);

  const createConversation = async () => {
    if (creatingSession) return;
    setCreatingSession(true);
    try {
      const created = await gateway.createSession();
      // A list request started before sessions.create completed must not erase
      // the new row or selection when it returns with an older snapshot.
      sessionsRequestRef.current += 1;
      setSessions((current) => [created, ...current.filter((session) => session.key !== created.key)]);
      setSelectedChannelId(undefined);
      setSelectedKey(created.key);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not create a conversation");
    } finally {
      setCreatingSession(false);
    }
  };

  const choosePrivateChat = (key: string) => {
    setSelectedChannelId(undefined);
    setSelectedKey(key);
  };

  const chooseTeamChannel = (channelId: string) => {
    setSelectedKey(undefined);
    setSelectedChannelId(channelId);
  };

  const openTeamTerminal = async (session?: TerminalDescriptor) => {
    if (!selectedChannel || !onOpenTeamTerminal || teamTerminalOpening) return;
    setTeamTerminalOpening(true);
    try {
      const opened = await onOpenTeamTerminal(selectedChannel, session);
      if (opened) {
        setTeamTerminals((current) => [opened, ...current.filter((candidate) => candidate.id !== opened.id)]);
        setTerminalSidebarOpen(true);
      }
    } finally {
      setTeamTerminalOpening(false);
    }
  };

  const createTeamChannel = async (input: { name: string; audience: "restricted" | "everyone"; memberIds: string[] }, source?: SessionRow) => {
    try {
      let importedMessages: Array<{ role: "user" | "assistant"; body: string }> | undefined;
      if (source) {
        const history = await gateway.loadHistory(source.key);
        const candidates = history.flatMap((message) => message.role === "user" || message.role === "assistant"
          ? [{ role: message.role, body: message.text.trim().slice(0, 128 * 1024) }]
          : []).filter((message) => message.body).slice(-2_000);
        importedMessages = [];
        let importedCharacters = 0;
        for (const message of candidates.toReversed()) {
          if (importedCharacters + message.body.length > 15 * 1024 * 1024) break;
          importedMessages.unshift(message);
          importedCharacters += message.body.length;
        }
      }
      const created = await teamChatApi.create(csrfToken, {
        ...input,
        ...(source ? { sourceSessionKey: source.key, importedMessages } : {}),
      });
      setTeamChannels((current) => [created.channel, ...current.filter((channel) => channel.id !== created.channel.id)]);
      setTeamDialog(undefined);
      chooseTeamChannel(created.channel.id);
      if (source) {
        try {
          await gateway.patchSession(source, { archived: true });
          setSessions((current) => current.map((item) => item.key === source.key ? { ...item, archived: true } : item));
        } catch {
          notify("The Team Chat was created, but the original private chat could not be archived.");
        }
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not create Team Chat");
    }
  };

  const renameTeamChannel = async (channel: TeamChannel) => {
    const name = window.prompt("Rename Team Chat", channel.name)?.trim();
    if (!name || name === channel.name) return;
    try {
      await teamChatApi.update(csrfToken, channel.id, { name });
      await refreshTeamChannels();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not rename Team Chat");
    }
  };

  const togglePin = async (channel: TeamChannel) => {
    try {
      await teamChatApi.update(csrfToken, channel.id, { pinned: !channel.pinned });
      await refreshTeamChannels();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not update the channel pin");
    }
  };

  const deleteTeamChannel = async (channel: TeamChannel) => {
    if (!window.confirm(`Delete #${channel.name} and its full history? This cannot be undone.`)) return;
    try {
      await teamChatApi.remove(csrfToken, channel.id);
      setTeamChannels((current) => current.filter((item) => item.id !== channel.id));
      if (selectedChannelId === channel.id) setSelectedChannelId(undefined);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not delete Team Chat");
    }
  };

  const leaveTeamChannel = async (channel: TeamChannel) => {
    if (!window.confirm(`Leave #${channel.name}?`)) return;
    try {
      await teamChatApi.removeMember(csrfToken, channel.id, currentUser.id);
      setTeamChannels((current) => current.filter((item) => item.id !== channel.id));
      if (selectedChannelId === channel.id) setSelectedChannelId(undefined);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not leave Team Chat");
    }
  };

  const openMemberManager = async (channel: TeamChannel) => {
    try {
      const result = await teamChatApi.members(channel.id);
      setTeamMembers(result.users);
      setManageChannel(channel);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load channel members");
    }
  };

  const saveChannelMembers = async (channel: TeamChannel, selectedIds: string[]) => {
    const currentIds = new Set(teamMembers.map((user) => user.id));
    const nextIds = new Set(selectedIds);
    const additions = selectedIds.filter((id) => !currentIds.has(id));
    const removals = teamMembers.filter((user) => !nextIds.has(user.id) && user.id !== channel.ownerUserId);
    try {
      if (additions.length) await teamChatApi.addMembers(csrfToken, channel.id, additions);
      for (const user of removals) await teamChatApi.removeMember(csrfToken, channel.id, user.id);
      setManageChannel(undefined);
      await refreshTeamChannels();
      if (selectedChannelId === channel.id) {
        const result = await teamChatApi.members(channel.id);
        setTeamMembers(result.users);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not update channel members");
    }
  };

  const selectTeamFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, 50);
    event.target.value = "";
    if (!files.length) return;
    try {
      await createWorkspaceFolder("", "team-uploads").catch(() => undefined);
      const uploaded: TeamAttachment[] = [];
      for (const file of files) {
        const uniqueName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${file.name}`;
        const renamed = new File([file], uniqueName, { type: file.type, lastModified: file.lastModified });
        const result = await uploadWorkspaceFile("team-uploads", renamed);
        uploaded.push({ path: result.item.path, name: file.name, ...(file.type ? { type: file.type } : {}), size: file.size });
      }
      setTeamAttachments((current) => [...current, ...uploaded].slice(0, 100));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not upload Team Chat attachment");
    }
  };

  const postTeamMessage = (body: string, messageAttachments: TeamAttachment[], channel = selectedChannel): boolean => {
    if (!channel || (!body && messageAttachments.length === 0)) return false;
    const socket = teamSocket.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      notify("Team Chat is reconnecting. Your draft has been kept.");
      return false;
    }
    transcriptPinnedToBottom.current = true;
    setShowJumpToLatest(false);
    if (invokesTeamAgent(body)) setTeamAgentPhase("starting");
    socket.send(JSON.stringify({
      type: "post",
      channelId: channel.id,
      clientRequestId: crypto.randomUUID(),
      body,
      attachments: messageAttachments,
    }));
    socket.send(JSON.stringify({ type: "typing", channelId: channel.id, active: false }));
    return true;
  };

  const sendTeamMessage = () => {
    const body = teamDraft.trim();
    if (!postTeamMessage(body, teamAttachments)) return;
    setTeamDraft("");
    setTeamAttachments([]);
    setTeamSkillTrigger(null);
  };

  const stopTeamVoiceMemo = () => {
    const recorder = teamVoiceRecorder.current;
    if (recorder?.state === "recording") recorder.stop();
  };

  const toggleTeamVoiceMemo = async () => {
    if (teamVoiceState === "recording") {
      stopTeamVoiceMemo();
      return;
    }
    if (teamVoiceState !== "idle" || !selectedChannel) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      notify("This browser does not support recording voice memos.");
      return;
    }
    const channel = selectedChannel;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      teamVoiceStream.current = stream;
      teamVoiceChunks.current = [];
      const mimeType = supportedRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      teamVoiceRecorder.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) teamVoiceChunks.current.push(event.data);
      };
      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (teamVoiceTimer.current) window.clearInterval(teamVoiceTimer.current);
        setTeamVoiceState("idle");
        notify("The voice memo could not be recorded.");
      };
      recorder.onstop = async () => {
        if (teamVoiceTimer.current) window.clearInterval(teamVoiceTimer.current);
        teamVoiceTimer.current = undefined;
        stream.getTracks().forEach((track) => track.stop());
        teamVoiceStream.current = undefined;
        const audio = new Blob(teamVoiceChunks.current, { type: recorder.mimeType || mimeType || "audio/webm" });
        teamVoiceChunks.current = [];
        if (!audio.size) {
          setTeamVoiceState("idle");
          notify("The voice memo was empty.");
          return;
        }
        if (audio.size > 25 * 1024 * 1024) {
          setTeamVoiceState("idle");
          notify("Voice memos must be 25 MB or smaller.");
          return;
        }
        try {
          setTeamVoiceState("transcribing");
          const transcript = await transcribeVoiceMemo(audio);
          setTeamVoiceState("sending");
          await createWorkspaceFolder("", "team-uploads").catch(() => undefined);
          const extension = voiceMemoExtension(audio.type);
          const storedName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-voice-memo.${extension}`;
          const file = new File([audio], storedName, { type: audio.type });
          const uploaded = await uploadWorkspaceFile("team-uploads", file);
          const attachment: TeamAttachment = {
            path: uploaded.item.path,
            name: `Voice memo.${extension}`,
            type: audio.type,
            size: audio.size,
          };
          const body = `@Neura\n\nVoice memo transcript:\n${transcript}`;
          if (!postTeamMessage(body, [attachment], channel)) {
            setTeamDraft(body);
            setTeamAttachments((current) => [...current, attachment]);
          }
        } catch (error) {
          notify(error instanceof Error ? error.message : "Could not send the voice memo.");
        } finally {
          teamVoiceRecorder.current = undefined;
          setTeamVoiceState("idle");
          setTeamVoiceSeconds(0);
        }
      };
      teamVoiceStartedAt.current = Date.now();
      setTeamVoiceSeconds(0);
      setTeamVoiceState("recording");
      recorder.start(1_000);
      teamVoiceTimer.current = window.setInterval(() => {
        const seconds = Math.floor((Date.now() - teamVoiceStartedAt.current) / 1_000);
        setTeamVoiceSeconds(seconds);
        if (seconds >= 300) stopTeamVoiceMemo();
      }, 1_000);
    } catch (error) {
      teamVoiceStream.current?.getTracks().forEach((track) => track.stop());
      teamVoiceStream.current = undefined;
      setTeamVoiceState("idle");
      notify(error instanceof Error ? error.message : "Could not access the microphone.");
    }
  };

  const handleTeamDraft = (value: string) => {
    setTeamDraft(value);
    const socket = teamSocket.current;
    if (!selectedChannel || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "typing", channelId: selectedChannel.id, active: Boolean(value.trim()) }));
    if (teamTypingTimer.current) window.clearTimeout(teamTypingTimer.current);
    teamTypingTimer.current = window.setTimeout(() => {
      socket.send(JSON.stringify({ type: "typing", channelId: selectedChannel.id, active: false }));
    }, 1_500);
  };

  const syncTeamSkillTrigger = (value: string, caret: number) => {
    setTeamSkillTrigger(skillTriggerAt(value, caret));
    setTeamSkillMenuIndex(0);
  };

  const selectTeamSkillSuggestion = (skill: SkillSuggestion) => {
    if (!teamSkillTrigger) return;
    const before = teamDraft.slice(0, teamSkillTrigger.start);
    const after = teamDraft.slice(teamSkillTrigger.end);
    const command = skillCommand(skill);
    const separator = after.length === 0 || !/^\s/.test(after) ? " " : "";
    const next = `${before}${command}${separator}${after}`;
    const nextCaret = before.length + command.length + separator.length;
    handleTeamDraft(next);
    setTeamSkillTrigger(null);
    window.requestAnimationFrame(() => {
      teamComposerInput.current?.focus();
      teamComposerInput.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleTeamComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (teamSkillTrigger && matchingTeamSkills.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setTeamSkillMenuIndex((current) => (current + direction + matchingTeamSkills.length) % matchingTeamSkills.length);
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        selectTeamSkillSuggestion(matchingTeamSkills[teamSkillMenuIndex % matchingTeamSkills.length]);
        return;
      }
    }
    if (event.key === "Escape" && teamSkillTrigger) {
      event.preventDefault();
      setTeamSkillTrigger(null);
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    sendTeamMessage();
  };

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const accepted = files.filter((file) => file.size <= 15 * 1024 * 1024);
    if (accepted.length !== files.length) notify("Files must be 15 MB or smaller.");
    const next = accepted.map((file) => {
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      if (previewUrl) attachmentObjectUrls.current.add(previewUrl);
      return { id: crypto.randomUUID(), file, previewUrl };
    });
    setAttachments((current) => [...current, ...next]);
    event.target.value = "";
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const match = current.find((attachment) => attachment.id === id);
      if (match?.previewUrl) {
        URL.revokeObjectURL(match.previewUrl);
        attachmentObjectUrls.current.delete(match.previewUrl);
      }
      return current.filter((attachment) => attachment.id !== id);
    });
  };

  const restoreComposer = (message: string, outgoing: ComposerAttachment[]) => {
    setDraft((current) => current.trim() ? `${message}${message ? "\n" : ""}${current}` : message);
    setAttachments((current) => [...outgoing, ...current]);
  };

  const sendMessage = async () => {
    const message = draft.trim();
    if (composerSubmittingRef.current || !selected || !sessionReady || (!message && attachments.length === 0) || connection !== "connected") return;
    const wasBusy = agentBusy;
    const outgoing = attachments;
    const localId = `local:${crypto.randomUUID()}`;
    transcriptPinnedToBottom.current = true;
    setShowJumpToLatest(false);
    if (!wasBusy) replaceActivities([]);
    composerSubmittingRef.current = true;
    setComposerSubmitting(true);
    setDraft("");
    setSkillTrigger(null);
    setAttachments([]);
    setMessages((current) => [...current, {
      id: localId,
      role: "user",
      text: message || outgoing.map((attachment) => attachment.file.name).join(", "),
      attachments: outgoing.map((attachment) => ({ name: attachment.file.name, type: attachment.file.type, url: attachment.previewUrl })),
    }]);
    try {
      const result = await gateway.send(selected, message, outgoing, "steer");
      if (!wasBusy && result.runId) {
        runIdRef.current = result.runId;
        setRunId(result.runId);
      }
      setSessions((current) => current.map((session) => session.key === selected.key ? { ...session, active: true } : session));
    } catch (error) {
      setMessages((current) => current.filter((item) => item.id !== localId));
      restoreComposer(message, outgoing);
      notify(error instanceof Error ? error.message : "Neura could not send that message");
    } finally {
      composerSubmittingRef.current = false;
      setComposerSubmitting(false);
    }
  };

  const queueMessage = async () => {
    if (!agentBusy) {
      await sendMessage();
      return;
    }
    const message = draft.trim();
    if (composerSubmittingRef.current || !selected || !sessionReady || (!message && attachments.length === 0) || connection !== "connected") return;
    const outgoing = attachments;
    const queuedId = crypto.randomUUID();
    const queued: QueuedPrompt = {
      id: queuedId,
      sessionKey: selected.key,
      text: message,
      attachments: outgoing.map((attachment) => ({ name: attachment.file.name, type: attachment.file.type })),
      status: "sending",
    };
    composerSubmittingRef.current = true;
    setComposerSubmitting(true);
    updateQueuedPrompts((current) => [...current, queued]);
    setDraft("");
    setSkillTrigger(null);
    setAttachments([]);
    try {
      const result = await gateway.send(selected, message, outgoing, "followup");
      updateQueuedPrompts((current) => current.map((prompt) => prompt.id === queuedId
        ? { ...prompt, runId: result.runId, status: "queued" }
        : prompt));
      for (const attachment of outgoing) if (attachment.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
        attachmentObjectUrls.current.delete(attachment.previewUrl);
      }
    } catch (error) {
      updateQueuedPrompts((current) => current.filter((prompt) => prompt.id !== queuedId));
      restoreComposer(message, outgoing);
      notify(error instanceof Error ? error.message : "Neura could not queue that message");
    } finally {
      composerSubmittingRef.current = false;
      setComposerSubmitting(false);
    }
  };

  const removeQueuedPrompt = async (prompt: QueuedPrompt) => {
    if (!prompt.runId) return;
    try {
      await gateway.abort(prompt.sessionKey, prompt.runId);
      updateQueuedPrompts((current) => current.filter((item) => item.id !== prompt.id));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not remove that queued message");
    }
  };

  const syncSkillTrigger = (value: string, caret: number) => {
    setSkillTrigger(skillTriggerAt(value, caret));
    setSkillMenuIndex(0);
  };

  const selectSkillSuggestion = (skill: SkillSuggestion) => {
    if (!skillTrigger) return;
    const before = draft.slice(0, skillTrigger.start);
    const after = draft.slice(skillTrigger.end);
    const command = skillCommand(skill);
    const separator = after.length === 0 || !/^\s/.test(after) ? " " : "";
    const next = `${before}${command}${separator}${after}`;
    const nextCaret = before.length + command.length + separator.length;
    setDraft(next);
    setSkillTrigger(null);
    window.requestAnimationFrame(() => {
      composerInput.current?.focus();
      composerInput.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (skillTrigger && matchingSkills.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setSkillMenuIndex((current) => (current + direction + matchingSkills.length) % matchingSkills.length);
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        selectSkillSuggestion(matchingSkills[skillMenuIndex % matchingSkills.length]);
        return;
      }
    }
    if (event.key === "Escape" && skillTrigger) {
      event.preventDefault();
      setSkillTrigger(null);
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void (event.ctrlKey || event.metaKey ? queueMessage() : sendMessage());
  };

  const renameSession = async (session: SessionRow) => {
    const label = window.prompt("Rename conversation", session.title)?.trim();
    if (!label || label === session.title) return;
    try {
      await gateway.patchSession(session, { label });
      setSessions((current) => current.map((item) => item.key === session.key ? { ...item, title: label } : item));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not rename the conversation");
    }
  };

  const archiveSession = async (session: SessionRow) => {
    try {
      await gateway.patchSession(session, { archived: !session.archived });
      setSessions((current) => current.map((item) => item.key === session.key ? { ...item, archived: !item.archived } : item));
      if (session.key === selectedKey) setSelectedKey(undefined);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not update the conversation");
    }
  };

  const deleteSession = async (session: SessionRow) => {
    if (!window.confirm(`Delete “${session.title}” and its transcript? This cannot be undone.`)) return;
    try {
      await gateway.deleteSession(session);
      setSessions((current) => current.filter((item) => item.key !== session.key));
      if (session.key === selectedKey) setSelectedKey(undefined);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not delete the conversation");
    }
  };

  const resolveApproval = async (approval: NeuraApproval, decision: NeuraApproval["decisions"][number]) => {
    try {
      await gateway.resolveApproval(approval.id, approval.kind, decision);
      setApprovals((current) => current.filter((item) => item.id !== approval.id));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not resolve the approval");
    }
  };

  const teamChannelRow = (channel: TeamChannel) => (
    <div className={`history-row team-channel-row${channel.id === selectedChannelId ? " is-selected" : ""}`} key={channel.id}>
      <button type="button" className="history-select" onClick={() => chooseTeamChannel(channel.id)}>
        <span>{channel.pinned && <Pin aria-hidden="true" />}<Hash aria-hidden="true" />{channel.name}</span>
        <small>{channel.mentionCount > 0 ? `${channel.mentionCount} mention${channel.mentionCount === 1 ? "" : "s"}` : channel.unreadCount > 0 ? `${channel.unreadCount} unread` : `${channel.memberCount} members`}</small>
      </button>
      <details className="history-menu">
        <summary aria-label={`Actions for ${channel.name}`}><MoreHorizontal /></summary>
        <div>
          {channel.canManage && channel.audience === "restricted" && <button type="button" onClick={() => void openMemberManager(channel)}><UserPlus />Members</button>}
          {channel.canManage && <button type="button" onClick={() => void renameTeamChannel(channel)}>Rename</button>}
          {channel.canPin && <button type="button" onClick={() => void togglePin(channel)}><Pin />{channel.pinned ? "Unpin" : "Pin"}</button>}
          {!channel.canManage && channel.audience === "restricted" && channel.ownerUserId !== currentUser.id && <button type="button" onClick={() => void leaveTeamChannel(channel)}>Leave</button>}
          {channel.canManage && <button type="button" className="danger" onClick={() => void deleteTeamChannel(channel)}><Trash2 />Delete</button>}
        </div>
      </details>
    </div>
  );

  const sidebar = (
    <aside className="neura-sidebar">
      <div className="sidebar-heading">
        <button type="button" className="new-chat-button" disabled={creatingSession} aria-busy={creatingSession} onClick={() => void createConversation()}><MessageSquarePlus /> {creatingSession ? "Creating…" : "New chat"}</button>
        <button type="button" className="sidebar-close" onClick={() => { setSidebarOpen(false); setMobileDrawer(false); }} aria-label="Close conversation history"><PanelLeftClose /></button>
      </div>
      <div className="history-switcher">
        <button type="button" className={!showArchived ? "active" : ""} onClick={() => setShowArchived(false)}>Recent</button>
        <button type="button" className={showArchived ? "active" : ""} onClick={() => setShowArchived(true)}>Archived</button>
      </div>
      <nav className="history-list" aria-label="Neura conversation history">
        <section className="history-section" aria-labelledby="private-chat-heading">
          <h2 id="private-chat-heading"><LockKeyhole />Your chats</h2>
          {privateSessions.length === 0 && <p className="history-empty">{showArchived ? "No archived private chats" : "Start a private conversation with Neura."}</p>}
          {privateSessions.map((session) => (
            <div className={`history-row${session.key === selectedKey && !selectedChannelId ? " is-selected" : ""}`} key={session.key}>
              <button type="button" className="history-select" onClick={() => choosePrivateChat(session.key)}>
                <span>{session.title}</span><small>{session.active ? "Active now" : relativeTime(session.updatedAt)}</small>
              </button>
              <details className="history-menu">
                <summary aria-label={`Actions for ${session.title}`}><MoreHorizontal /></summary>
                <div>
                  <button type="button" onClick={() => void renameSession(session)}>Rename</button>
                  {!session.archived && <button type="button" onClick={() => setTeamDialog({ source: session })}><Users />Share as Team Chat</button>}
                  <button type="button" onClick={() => void archiveSession(session)}>{session.archived ? <ArchiveRestore /> : <Archive />}{session.archived ? "Unarchive" : "Archive"}</button>
                  <button type="button" className="danger" onClick={() => void deleteSession(session)}><Trash2 />Delete</button>
                </div>
              </details>
            </div>
          ))}
        </section>
        <section className="history-section team-chat-section" aria-labelledby="team-chat-heading">
          <h2 id="team-chat-heading">
            <span className="team-section-title"><Users />Team chats</span>
            <button type="button" className="team-chat-create-button" aria-label="New Team Chat" onClick={() => setTeamDialog({})}><MessageSquarePlus /><span>New</span></button>
          </h2>
          {teamChannels.length === 0 && <div className="team-chat-empty"><p>Create a live channel with invited teammates or everyone.</p><button type="button" onClick={() => setTeamDialog({})}><MessageSquarePlus />New Team Chat</button></div>}
          {pinnedTeamChannels.length > 0 && <p className="team-channel-label">Pinned</p>}
          {pinnedTeamChannels.map(teamChannelRow)}
          {pinnedTeamChannels.length > 0 && regularTeamChannels.length > 0 && <p className="team-channel-label">Channels</p>}
          {regularTeamChannels.map(teamChannelRow)}
        </section>
      </nav>
      <p className="shared-note"><LockKeyhole />Private chats stay yours until you share one</p>
    </aside>
  );

  return (
    <div className={`neura-app${sidebarOpen ? " has-sidebar" : ""}`}>
      {sidebarOpen && sidebar}
      {mobileDrawer && <><button className="drawer-scrim" type="button" aria-label="Close history" onClick={() => setMobileDrawer(false)} />{sidebar}</>}
      <main className="neura-main">
        <header className="neura-toolbar">
          <button type="button" className="sidebar-toggle" onClick={() => appViewport.mobile ? setMobileDrawer(true) : setSidebarOpen(true)} aria-label="Open conversation history">
            {appViewport.mobile ? <Menu /> : <PanelLeftOpen />}
          </button>
          <div>
            <strong>{creatingSession ? "New conversation" : selectedChannel ? `# ${selectedChannel.name}` : selected?.title ?? "Neura"}</strong>
            <span className={`connection connection-${selectedChannel ? teamConnection : connection}`}>
              {creatingSession
                ? "Creating a private session"
                : selectedChannel
                ? teamConnection === "connected" ? `${selectedChannel.memberCount} members · live` : teamConnection
                : connection === "connected" ? selected && !sessionReady ? "Syncing conversation" : "Connected through OpenClaw" : connection}
            </span>
          </div>
          {selectedChannel?.canManage && selectedChannel.audience === "restricted" && <div className="team-toolbar-actions">
            {selectedChannel.canManage && selectedChannel.audience === "restricted" && <button type="button" className="team-members-button" onClick={() => void openMemberManager(selectedChannel)}><Users />{teamMembers.length || selectedChannel.memberCount}</button>}
          </div>}
        </header>

        <div className="message-stage">
        <div ref={messageScroll} className="message-scroll" aria-live="polite" onScroll={handleTranscriptScroll}>
          <div ref={messageContent} className="message-content">
          {creatingSession ? <NeuraSessionLoader stage="creating" /> : <>
          {!selectedChannel && connection === "error" && <div className="connection-error"><strong>Neura is unavailable</strong><p>{connectionError ?? "The Gateway connection could not be established."} If this is your first visit, connect your ChatGPT account in Settings → Personalization.</p></div>}
          {selectedChannel && teamConnection === "error" && <div className="connection-error"><strong>Team Chat is reconnecting</strong><p>Messages remain safely stored. Live updates will resume automatically.</p></div>}
          {selectedChannel && teamAgentError && <div className="connection-error"><strong>Neura could not join this turn</strong><p>{teamAgentError}</p></div>}
          {!selected && !selectedChannel && connection === "connected" && (
            <div className="neura-welcome">
              <div className="neura-orb">N</div>
              <h1>Work with Neura</h1>
              <p>Neura is your OpenClaw agent. New conversations are private to your account.</p>
              <button type="button" onClick={() => void createConversation()}><MessageSquarePlus />Start a conversation</button>
            </div>
          )}
          {selected && !selectedChannel && messages.length === 0 && !sessionReady && <NeuraSessionLoader stage="connecting" />}
          {selected && !selectedChannel && messages.length === 0 && sessionReady && (
            <div className="neura-welcome compact"><div className="neura-orb">N</div><h1>What should we work on?</h1><p>{selected.visibility === "draft" ? "Only you can see and write in this conversation." : "This conversation is shared with your team."}</p></div>
          )}
          {!selectedChannel && messages.map((message) => (
            <article className={`message message-${message.role}`} key={message.id}>
              {message.role === "assistant" && <div className="message-avatar">N</div>}
              <div className="message-body">
                <span className="message-author">{message.role === "assistant" ? "Neura" : message.role === "user" ? "You" : "System"}</span>
                {message.attachments && message.attachments.length > 0 && <MessageAttachments attachments={message.attachments} />}
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                  a: ({ href, children }) => {
                    const websitePreview = message.role === "assistant" ? neuraWebsitePreviewFile(href, message.text) : undefined;
                    if (websitePreview) return <button type="button" className="message-preview-link" onClick={() => onPreviewFile ? onPreviewFile(websitePreview) : notify("The desktop Preview app is unavailable.")} title="Open in desktop Preview">{children}</button>;
                    const target = message.role === "assistant" ? resolveNeuraMessageLink(href, message.text) : href;
                    const preview = target !== href;
                    return <a href={target} target="_blank" rel="noreferrer" title={preview ? "Open website preview" : undefined}>{children}</a>;
                  },
                  img: ({ src, alt }) => <img className="message-markdown-image" src={message.role === "assistant" ? resolveNeuraMessageImage(src) : src} alt={alt ?? "Shared image"} loading="lazy" />,
                }}>{message.text}</ReactMarkdown>
                {message.activities && message.activities.length > 0 && <NeuraActivityTimeline activities={message.activities} />}
                {message.pending && <span className="typing-cursor" aria-label="Neura is responding" />}
              </div>
            </article>
          ))}
          {selectedChannel && teamMessages.length === 0 && (
            <div className="neura-welcome compact"><div className="neura-orb"><Hash /></div><h1>#{selectedChannel.name}</h1><p>{selectedChannel.audience === "everyone" ? "Everyone with Neural Labs access can join this conversation." : "This is a private channel for invited teammates."} Type <strong>@Neura</strong> when you want the agent to join in.</p></div>
          )}
          {selectedChannel && teamMessages.map((message) => {
            const neura = message.authorKind === "neura" || message.authorKind === "imported_neura";
            const system = message.authorKind === "system";
            const presentation = teamMessagePresentation(message, currentUser.id);
            const author = neura ? "Neura" : system ? "System" : message.author?.displayName ?? "Former teammate";
            return <article className={`message team-message message-${presentation}`} key={message.id}>
              {neura && <div className="message-avatar">N</div>}
              <div className="message-body">
                <span className="message-author">{author}{message.author && <small>@{message.author.handle}</small>}</span>
                {message.attachments.length > 0 && <MessageAttachments attachments={message.attachments} className="message-attachments team-message-attachments" />}
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                  a: ({ href, children }) => {
                    const websitePreview = neura ? neuraWebsitePreviewFile(href, message.body) : undefined;
                    if (websitePreview) return <button type="button" className="message-preview-link" onClick={() => onPreviewFile ? onPreviewFile(websitePreview) : notify("The desktop Preview app is unavailable.")} title="Open in desktop Preview">{children}</button>;
                    return <a href={neura ? resolveNeuraMessageLink(href, message.body) : href} target="_blank" rel="noreferrer">{children}</a>;
                  },
                  img: ({ src, alt }) => <img className="message-markdown-image" src={neura ? resolveNeuraMessageImage(src) : src} alt={alt ?? "Shared image"} loading="lazy" />,
                }}>{message.body}</ReactMarkdown>
                {(message.activities?.length ?? 0) > 0 && <NeuraActivityTimeline activities={message.activities!.map((activity, index) => ({ ...activity, id: `${message.id}:${index}`, sessionKey: `team:${message.channelId}`, runId: message.agentRunId }))} />}
                <time dateTime={message.createdAt}>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(message.createdAt))}</time>
              </div>
            </article>;
          })}
          {selectedChannel && teamAgentPhase && <article className="message team-agent-loader message-assistant" role="status" aria-label={teamAgentPhase === "starting" ? "Neura is starting" : "Neura is working"}>
            <div className="message-avatar">N</div>
            <div className="message-body">
              <span className="message-author">Neura</span>
              <div className="team-agent-loader-status">
                <span className="activity-spinner" aria-hidden="true" />
                <span><strong>{teamAgentPhase === "starting" ? "Starting Neura…" : "Neura is working…"}</strong><small>{teamAgentPhase === "starting" ? "Preparing your personal agent for this team channel." : "Work continues even if you leave this channel or the app reconnects."}</small></span>
              </div>
            </div>
          </article>}
          {!selectedChannel && activities.length > 0 && <NeuraActivityTimeline activities={activities} live={agentBusy} />}
          </>}
          </div>
        </div>
        {showJumpToLatest && <button type="button" className="jump-to-latest" onClick={() => scrollToLatest("smooth")}><ChevronDown />Latest</button>}
        </div>

        {!creatingSession && selectedChannel && (
          <footer className="neura-composer-area team-composer-area">
            {teamTyping.length > 0 && <div className="team-presence" role="status">
              {teamTyping.length > 0 && <span>{teamTyping.map((user) => `@${user.handle}`).join(", ")} {teamTyping.length === 1 ? "is" : "are"} typing…</span>}
            </div>}
            <div className="composer-shell">
              {teamSkillTrigger && <div className="skill-mention-menu" id="team-skill-suggestions" role="listbox" aria-label="Available Team Chat skills">
                <div className="skill-mention-menu__heading" role="presentation"><strong>Skills</strong><span>Type to filter · Enter to add</span></div>
                {!skillsLoaded && <p className="skill-mention-menu__empty">Loading skills…</p>}
                {skillsLoaded && matchingTeamSkills.length === 0 && <p className="skill-mention-menu__empty">No matching enabled skills</p>}
                {matchingTeamSkills.map((skill, index) => (
                  <button
                    type="button"
                    role="option"
                    id={`team-skill-option-${index}`}
                    aria-selected={index === teamSkillMenuIndex}
                    className={index === teamSkillMenuIndex ? "is-selected" : ""}
                    key={skill.key}
                    onMouseEnter={() => setTeamSkillMenuIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectTeamSkillSuggestion(skill)}
                  >
                    <span className="skill-mention-menu__mark">$</span>
                    <span className="skill-mention-menu__copy"><strong>{skill.name}</strong><small>{skill.description}</small></span>
                    <code>{skillCommand(skill)}</code>
                  </button>
                ))}
              </div>}
              {teamAttachments.length > 0 && <div className="composer-attachments">{teamAttachments.map((attachment) => <div key={attachment.path}>{isImageAttachment({ name: attachment.name, type: attachment.type ?? "" }) ? <img src={workspaceContentUrl(attachment.path)} alt="" /> : <Paperclip />}<span>{attachment.name}</span><button type="button" onClick={() => setTeamAttachments((current) => current.filter((item) => item.path !== attachment.path))} aria-label={`Remove ${attachment.name}`}><X /></button></div>)}</div>}
              <div className="composer-row">
                <input ref={teamFileInput} type="file" multiple hidden onChange={(event) => void selectTeamFiles(event)} />
                <button type="button" className="attach-button" disabled={teamConnection !== "connected"} onClick={() => teamFileInput.current?.click()} aria-label="Attach workspace files"><Paperclip /></button>
                <button
                  type="button"
                  className={`voice-button${teamVoiceState === "recording" ? " is-live" : ""}`}
                  onClick={() => void toggleTeamVoiceMemo()}
                  disabled={teamVoiceState !== "recording" && (teamConnection !== "connected" || teamVoiceState !== "idle")}
                  aria-label={teamVoiceState === "recording" ? "Stop and send voice memo" : teamVoiceState === "transcribing" ? "Transcribing voice memo" : teamVoiceState === "sending" ? "Sending voice memo" : "Record a Team Chat voice memo"}
                  title={teamVoiceState === "recording" ? `Stop and send voice memo · ${Math.floor(teamVoiceSeconds / 60)}:${String(teamVoiceSeconds % 60).padStart(2, "0")}` : "Record a voice memo"}
                ><AudioWaveform /></button>
                <textarea
                  ref={teamComposerInput}
                  value={teamDraft}
                  onChange={(event) => { handleTeamDraft(event.target.value); syncTeamSkillTrigger(event.target.value, event.target.selectionStart); }}
                  onClick={(event) => syncTeamSkillTrigger(event.currentTarget.value, event.currentTarget.selectionStart)}
                  onBlur={() => window.setTimeout(() => setTeamSkillTrigger(null), 100)}
                  onKeyDown={handleTeamComposerKey}
                  rows={1}
                  placeholder={`Message #${selectedChannel.name} · $ lists skills`}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-controls={teamSkillTrigger ? "team-skill-suggestions" : undefined}
                  aria-expanded={Boolean(teamSkillTrigger)}
                  aria-activedescendant={teamSkillTrigger && matchingTeamSkills.length > 0 ? `team-skill-option-${teamSkillMenuIndex % matchingTeamSkills.length}` : undefined}
                />
                <button type="button" className="send-button" onClick={sendTeamMessage} disabled={teamConnection !== "connected" || !teamDraft.trim() && teamAttachments.length === 0} aria-label="Send Team Chat message"><Send /></button>
              </div>
            </div>
            <p className="composer-hint">{teamVoiceState === "recording" ? `Recording voice memo · ${Math.floor(teamVoiceSeconds / 60)}:${String(teamVoiceSeconds % 60).padStart(2, "0")} · tap the wave to send` : teamVoiceState === "transcribing" ? "Transcribing voice memo for Neura…" : teamVoiceState === "sending" ? "Sending voice memo to the team…" : "Enter to send · Shift+Enter for a new line · the wave records a voice memo · @Neura invites the agent"}</p>
          </footer>
        )}

        {!creatingSession && selected && !selectedChannel && (
          <footer className="neura-composer-area">
            {approvals.filter((approval) => !approval.sessionKey || approval.sessionKey === selected.key).map((approval) => (
              <div className="approval-card" key={approval.id}>
                <div><strong>{approval.title}</strong><code>{approval.detail}</code></div>
                <div>{approval.decisions.map((decision) => (
                  <button type="button" className={decision === "deny" ? "deny" : ""} key={decision} onClick={() => void resolveApproval(approval, decision)}>
                    {decision === "allow-once" ? "Allow once" : decision === "allow-always" ? "Always allow" : "Deny"}
                  </button>
                ))}</div>
              </div>
            ))}
            {agentBusy && <div className="active-run-banner" role="status">
              <span className="activity-spinner" />
              <strong>Neura is working</strong>
              <span>Enter steers this run now. Ctrl/Cmd+Enter adds work to the queue.</span>
            </div>}
            {sessionQueue.length > 0 && <section className="prompt-queue" aria-label="Queued messages">
              <header>
                <span><ListOrdered /><strong>{sessionQueue.length} queued</strong></span>
                <small>Sends automatically, in order, when the current run finishes.</small>
              </header>
              <ol>
                {sessionQueue.map((prompt, index) => (
                  <li key={prompt.id}>
                    <span className="queue-position" aria-hidden="true">{index + 1}</span>
                    <span className="queue-copy">
                      <strong>{prompt.text || prompt.attachments.map((attachment) => attachment.name).join(", ")}</strong>
                      <small>{prompt.status === "sending" ? "Adding to queue…" : prompt.attachments.length > 0 ? `${prompt.attachments.length} attachment${prompt.attachments.length === 1 ? "" : "s"}` : "Waiting for Neura"}</small>
                    </span>
                    <button type="button" disabled={!prompt.runId} onClick={() => void removeQueuedPrompt(prompt)} aria-label={`Remove queued message ${index + 1}`}><X /></button>
                  </li>
                ))}
              </ol>
            </section>}
            <div className="composer-shell">
              {skillTrigger && <div className="skill-mention-menu" id="neura-skill-suggestions" role="listbox" aria-label="Available skills">
                <div className="skill-mention-menu__heading" role="presentation"><strong>Skills</strong><span>Type to filter · Enter to add</span></div>
                {!skillsLoaded && <p className="skill-mention-menu__empty">Loading skills…</p>}
                {skillsLoaded && matchingSkills.length === 0 && <p className="skill-mention-menu__empty">No matching enabled skills</p>}
                {matchingSkills.map((skill, index) => (
                  <button
                    type="button"
                    role="option"
                    id={`neura-skill-option-${index}`}
                    aria-selected={index === skillMenuIndex}
                    className={index === skillMenuIndex ? "is-selected" : ""}
                    key={skill.key}
                    onMouseEnter={() => setSkillMenuIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectSkillSuggestion(skill)}
                  >
                    <span className="skill-mention-menu__mark">$</span>
                    <span className="skill-mention-menu__copy"><strong>{skill.name}</strong><small>{skill.description}</small></span>
                    <code>{skillCommand(skill)}</code>
                  </button>
                ))}
              </div>}
              {attachments.length > 0 && <div className="composer-attachments">{attachments.map((attachment) => (
                <div key={attachment.id}>{attachment.previewUrl ? <img src={attachment.previewUrl} alt="" /> : <Paperclip />}<span>{attachment.file.name}</span><button type="button" onClick={() => removeAttachment(attachment.id)} aria-label={`Remove ${attachment.file.name}`}><X /></button></div>
              ))}</div>}
              <div className="composer-row">
                <input ref={fileInput} type="file" multiple hidden onChange={selectFiles} />
                <button type="button" className="attach-button" disabled={!sessionReady} onClick={() => fileInput.current?.click()} aria-label="Attach files or images"><Paperclip /></button>
                <button
                  type="button"
                  className={`voice-button${privateVoiceState === "live" ? " is-live" : ""}${privateVoiceState === "connecting" ? " is-connecting" : ""}`}
                  onClick={() => void togglePrivateVoice()}
                  disabled={privateVoiceState === "idle" && !sessionReady}
                  aria-label={privateVoiceState === "live" ? "End private Neura voice chat" : privateVoiceState === "connecting" ? "Cancel private Neura voice chat" : "Start private Neura voice chat"}
                  title={privateVoiceState === "live" ? "End voice chat" : "Start a private voice chat with Neura"}
                ><AudioWaveform /></button>
                <textarea
                  ref={composerInput}
                  disabled={!sessionReady}
                  value={draft}
                  onChange={(event) => { setDraft(event.target.value); syncSkillTrigger(event.target.value, event.target.selectionStart); }}
                  onClick={(event) => syncSkillTrigger(event.currentTarget.value, event.currentTarget.selectionStart)}
                  onBlur={() => window.setTimeout(() => setSkillTrigger(null), 100)}
                  onKeyDown={handleComposerKey}
                  rows={1}
                  placeholder={!sessionReady ? "Connecting conversation…" : agentBusy ? "Steer Neura now, or queue what comes next…" : "Message Neura…"}
                  aria-autocomplete="list"
                  aria-controls={skillTrigger ? "neura-skill-suggestions" : undefined}
                  aria-expanded={Boolean(skillTrigger)}
                  aria-activedescendant={skillTrigger && matchingSkills.length > 0 ? `neura-skill-option-${skillMenuIndex % matchingSkills.length}` : undefined}
                />
                {agentBusy && <button type="button" className="stop-button" onClick={() => void gateway.abort(selected.key, runId)} aria-label="Stop Neura"><Square /></button>}
                <div className="split-send">
                  <button type="button" className="send-button" onClick={() => void sendMessage()} disabled={composerSubmitting || !sessionReady || !draft.trim() && attachments.length === 0} aria-label={agentBusy ? "Steer active run" : "Send message"}><Send /></button>
                  {agentBusy && <details><summary aria-label="Send options"><ChevronDown /></summary><div><button type="button" disabled={composerSubmitting} onClick={() => void sendMessage()}>Steer active run <kbd>Enter</kbd></button><button type="button" disabled={composerSubmitting} onClick={() => void queueMessage()}>Queue after this run <kbd>⌘↵</kbd></button></div></details>}
                </div>
              </div>
            </div>
            <p className="composer-hint">{privateVoiceState === "live" ? "Private voice chat is live · tap the wave to end" : privateVoiceState === "connecting" ? "Connecting private voice chat…" : <>Enter to {agentBusy ? "steer now" : "send"} · Ctrl/Cmd+Enter to {agentBusy ? "queue next" : "send"} · the wave starts voice chat</>}</p>
          </footer>
        )}
      </main>
      {selectedChannel && <TeamTerminalSidebar
        channel={selectedChannel}
        members={teamMembers}
        sessions={teamTerminals}
        expanded={terminalSidebarOpen}
        loading={teamTerminalsLoading}
        error={teamTerminalsError}
        creating={teamTerminalOpening}
        disabled={!onOpenTeamTerminal}
        onExpandedChange={setTerminalSidebarOpen}
        onCreate={() => void openTeamTerminal()}
        onOpen={(session) => void openTeamTerminal(session)}
      />}
      {teamDialog && <TeamChannelDialog
        source={teamDialog.source}
        users={teamDirectory}
        currentUserId={currentUser.id}
        onClose={() => setTeamDialog(undefined)}
        onSubmit={(input) => createTeamChannel(input, teamDialog.source)}
      />}
      {manageChannel && <TeamMembersDialog
        channel={manageChannel}
        users={teamDirectory}
        members={teamMembers}
        onClose={() => setManageChannel(undefined)}
        onSubmit={(memberIds) => saveChannelMembers(manageChannel, memberIds)}
      />}
    </div>
  );
}

export function TeamTerminalSidebar({ channel, members, sessions, expanded, loading, error, creating, disabled, onExpandedChange, onCreate, onOpen }: {
  channel: Pick<TeamChannel, "id" | "name" | "memberCount">;
  members: TeamDirectoryUser[];
  sessions: TerminalDescriptor[];
  expanded: boolean;
  loading: boolean;
  error?: string;
  creating: boolean;
  disabled: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onCreate: () => void;
  onOpen: (session: TerminalDescriptor) => void;
}) {
  const activeCount = sessions.filter((session) => session.status === "running").length;
  return <aside className={`team-terminal-sidebar${expanded ? " is-expanded" : " is-collapsed"}`} aria-label={`Terminals for #${channel.name}`}>
    {!expanded ? <>
      <button type="button" className="team-terminal-rail-toggle" onClick={() => onExpandedChange(true)} aria-label={`Show terminals for #${channel.name}`} title="Channel terminals">
        <TerminalSquare />
        {activeCount > 0 && <span aria-label={`${activeCount} active terminal${activeCount === 1 ? "" : "s"}`}>{activeCount}</span>}
      </button>
      <button type="button" className="team-terminal-rail-create" onClick={onCreate} disabled={disabled || creating} aria-label={`Start a new terminal for #${channel.name}`} title="New channel terminal"><Plus /></button>
      {activeCount > 0 && <i className="team-terminal-rail-live" title="A channel terminal is active" />}
    </> : <>
      <header className="team-terminal-sidebar__header">
        <div className="team-terminal-sidebar__title"><span><TerminalSquare /></span><div><strong>Channel terminals</strong><small>#{channel.name}</small></div></div>
        <div className="team-terminal-sidebar__actions">
          <button type="button" onClick={onCreate} disabled={disabled || creating} aria-label={`Start a new terminal for #${channel.name}`} title="New channel terminal">{creating ? <span className="activity-spinner" /> : <Plus />}</button>
          <button type="button" onClick={() => onExpandedChange(false)} aria-label="Collapse channel terminals" title="Collapse"><PanelRightClose /></button>
        </div>
      </header>
      <div className="team-terminal-sidebar__summary">
        <span><i className={activeCount > 0 ? "is-live" : ""} />{activeCount > 0 ? `${activeCount} active` : "No active sessions"}</span>
        <small>{sessions.length} total</small>
      </div>
      <div className="team-terminal-channel-members">
        <span className="team-terminal-avatars" aria-label={`${channel.memberCount} Team Chat member${channel.memberCount === 1 ? "" : "s"}`}>
          {members.slice(0, 5).map((member) => <i key={member.id} title={`${member.displayName} (@${member.handle})`}>{personInitials(member.displayName)}</i>)}
          {channel.memberCount > 5 && <i className="is-more">+{channel.memberCount - 5}</i>}
        </span>
        <span><strong>{channel.memberCount} members</strong><small>Can discover and join</small></span>
      </div>
      <div className="team-terminal-sidebar__sessions">
        {loading && sessions.length === 0 && <div className="team-terminal-sidebar__empty" role="status"><span className="activity-spinner" /><strong>Checking terminals…</strong></div>}
        {!loading && error && sessions.length === 0 && <div className="team-terminal-sidebar__empty is-error"><TerminalSquare /><strong>Terminals unavailable</strong><small>{error}</small></div>}
        {!loading && !error && sessions.length === 0 && <div className="team-terminal-sidebar__empty"><TerminalSquare /><strong>No terminal sessions yet</strong><small>Start one to work together from this channel.</small><button type="button" onClick={onCreate} disabled={disabled || creating}><Plus />Start terminal</button></div>}
        {sessions.map((session) => <button type="button" className={`team-terminal-session${session.status === "running" ? " is-active" : " is-ended"}`} onClick={() => onOpen(session)} disabled={creating} key={session.id} aria-label={`Open terminal ${session.title}`}>
          <span className="team-terminal-session__status"><i /><strong>{session.status === "running" ? "Active" : "Ended"}</strong><time>{relativeTime(session.lastActivityAt || session.createdAt)}</time></span>
          <span className="team-terminal-session__name">{session.title}</span>
          <span className="team-terminal-session__meta"><code>{session.shell}</code><small>Started by {session.owner.label}</small></span>
          <span className="team-terminal-session__people">
            <span className="team-terminal-avatars" aria-label={`${session.participants.length} connected member${session.participants.length === 1 ? "" : "s"}`}>
              {session.participants.slice(0, 4).map((participant) => <i key={participant.id} title={participant.label}>{personInitials(participant.label)}</i>)}
              {session.participants.length > 4 && <i className="is-more">+{session.participants.length - 4}</i>}
            </span>
            <small>{session.participants.length > 0 ? `${session.participants.length} connected` : "No one connected"}</small>
          </span>
        </button>)}
      </div>
      <footer><PanelRightOpen /><span>Only members of this Team Chat can discover and join these terminals.</span></footer>
    </>}
  </aside>;
}

function personInitials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}` : label.slice(0, 2)).toUpperCase();
}

function NeuraSessionLoader({ stage }: { stage: "creating" | "connecting" }) {
  return <div className="neura-welcome compact neura-session-loader" role="status" aria-label="Preparing Neura conversation">
    <div className="neura-ready-orb" aria-hidden="true"><span>N</span><i /><i /><i /></div>
    <h1>{stage === "creating" ? "Starting a new chat" : "Getting Neura ready"}</h1>
    <p>{stage === "creating" ? "Creating your private conversation." : "Opening the live OpenClaw session and loading recent context."}</p>
    <div className="neura-ready-progress" aria-hidden="true">
      <span><Check />{stage === "creating" ? "Private session" : "Session created"}</span>
      <span><i />{stage === "creating" ? "Connecting to OpenClaw" : "Opening live connection"}</span>
    </div>
  </div>;
}

function NeuraActivityTimeline({ activities, live = false }: { activities: NeuraActivity[]; live?: boolean }) {
  const latest = activities.at(-1);
  const failed = activities.some((activity) => activity.state === "error");
  return <details className="neura-activity-timeline" data-state={failed ? "error" : live ? "running" : "done"}>
    <summary>
      <span className="neura-activity-beacon" aria-hidden="true">{live ? <span className="activity-spinner" /> : failed ? <X /> : <Check />}</span>
      <span className="neura-activity-summary"><strong>{live ? "Neura is working" : "Work details"}</strong><small>{latest?.title ?? "Agent activity"}</small></span>
      <span className="neura-activity-count">{activities.length} {activities.length === 1 ? "step" : "steps"}</span>
      <ChevronDown className="neura-activity-chevron" aria-hidden="true" />
    </summary>
    <div className="neura-activity-list">
      {activities.map((activity) => <NeuraActivityStep activity={activity} key={activity.id} />)}
    </div>
  </details>;
}

function NeuraActivityStep({ activity }: { activity: NeuraActivity }) {
  const kind = {
    thinking: "Thinking", command: "Command", plan: "Plan", tool: "Agent action",
    file: "File change", operation: "Maintenance",
  }[activity.kind];
  const symbol = { thinking: "✦", command: ">_", plan: "≡", tool: "◆", file: "±", operation: "↻" }[activity.kind];
  const preview = activity.command?.replaceAll(/\s+/g, " ").trim() || activity.path || activity.detail?.split("\n", 1)[0];
  return <details className={`neura-activity-step is-${activity.kind}`} data-state={activity.state}>
    <summary>
      <span className="neura-activity-icon" aria-hidden="true">{symbol}</span>
      <span className="neura-activity-copy"><small>{kind}</small><strong>{activity.title}</strong>{preview && <code>{preview}</code>}</span>
      <span className="neura-activity-state">{activity.state === "running" ? "Live" : activity.state === "error" ? "Failed" : "Done"}</span>
      <ChevronDown aria-hidden="true" />
    </summary>
    <div className="neura-activity-detail">
      {activity.detail && <p>{activity.detail}</p>}
      {activity.command && <section><small>Command</small><pre><code>{activity.command}</code></pre></section>}
      {activity.output && <section><small>Output</small><pre><code>{activity.output}</code></pre></section>}
      {activity.path && <section><small>Path</small><code>{activity.path}</code></section>}
      {(activity.exitCode !== undefined || activity.durationMs !== undefined) && <p className="neura-activity-meta">{activity.exitCode !== undefined ? `exit ${activity.exitCode}` : ""}{activity.exitCode !== undefined && activity.durationMs !== undefined ? " · " : ""}{activity.durationMs !== undefined ? activity.durationMs >= 1_000 ? `${(activity.durationMs / 1_000).toFixed(1)}s` : `${Math.round(activity.durationMs)}ms` : ""}</p>}
    </div>
  </details>;
}

function TeamChannelDialog({ source, users, currentUserId, onClose, onSubmit }: {
  source?: SessionRow | undefined;
  users: TeamDirectoryUser[];
  currentUserId: string;
  onClose: () => void;
  onSubmit: (input: { name: string; audience: "restricted" | "everyone"; memberIds: string[] }) => Promise<void>;
}) {
  const [name, setName] = useState(source?.title ?? "");
  const [audience, setAudience] = useState<"restricted" | "everyone">("restricted");
  const [members, setMembers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const candidates = users.filter((user) => user.id !== currentUserId);
  const submit = async () => {
    setSaving(true);
    try { await onSubmit({ name: name.trim(), audience, memberIds: members }); }
    finally { setSaving(false); }
  };
  return <div className="team-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="team-dialog" role="dialog" aria-modal="true" aria-labelledby="team-dialog-title">
      <header><div><span className="dialog-mark"><Users /></span><span><strong id="team-dialog-title">{source ? "Share as Team Chat" : "Create Team Chat"}</strong><small>{source ? "The private history will be copied into the new channel." : "Give your team a place to build together."}</small></span></div><button type="button" onClick={onClose} aria-label="Close"><X /></button></header>
      <label className="team-dialog-field"><span>Channel name</span><div><Hash /><input autoFocus value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="project-or-topic" /></div></label>
      <fieldset className="team-audience"><legend>Who can join?</legend>
        <label className={audience === "restricted" ? "is-selected" : ""}><input type="radio" name="audience" checked={audience === "restricted"} onChange={() => setAudience("restricted")} /><LockKeyhole /><span><strong>Invited teammates</strong><small>Only selected people can read the history.</small></span></label>
        <label className={audience === "everyone" ? "is-selected" : ""}><input type="radio" name="audience" checked={audience === "everyone"} onChange={() => setAudience("everyone")} /><Globe2 /><span><strong>Everyone</strong><small>Every active Neural Labs user can join.</small></span></label>
      </fieldset>
      {audience === "restricted" && <fieldset className="team-people"><legend>Invite teammates</legend>{candidates.length === 0 ? <p>No other active teammates are available yet.</p> : candidates.map((user) => <label key={user.id}><input type="checkbox" checked={members.includes(user.id)} onChange={(event) => setMembers((current) => event.target.checked ? [...current, user.id] : current.filter((id) => id !== user.id))} /><span className="team-person-avatar">{user.displayName.slice(0, 1).toUpperCase()}</span><span><strong>{user.displayName}</strong><small>@{user.handle}{user.role === "admin" ? " · Admin" : ""}</small></span></label>)}</fieldset>}
      <footer><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={saving || !name.trim() || audience === "restricted" && members.length === 0} onClick={() => void submit()}>{saving ? "Creating…" : source ? "Share chat" : "Create channel"}</button></footer>
    </section>
  </div>;
}

function TeamMembersDialog({ channel, users, members, onClose, onSubmit }: {
  channel: TeamChannel;
  users: TeamDirectoryUser[];
  members: TeamDirectoryUser[];
  onClose: () => void;
  onSubmit: (memberIds: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState(() => members.map((user) => user.id));
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try { await onSubmit(selected); } finally { setSaving(false); }
  };
  return <div className="team-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="team-dialog team-members-dialog" role="dialog" aria-modal="true" aria-labelledby="members-dialog-title">
      <header><div><span className="dialog-mark"><UserPlus /></span><span><strong id="members-dialog-title">Members of #{channel.name}</strong><small>Add people or remove existing members.</small></span></div><button type="button" onClick={onClose} aria-label="Close"><X /></button></header>
      <fieldset className="team-people"><legend>Active teammates</legend>{users.map((user) => {
        const owner = user.id === channel.ownerUserId;
        return <label key={user.id}><input type="checkbox" disabled={owner} checked={selected.includes(user.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, user.id] : current.filter((id) => id !== user.id))} /><span className="team-person-avatar">{user.displayName.slice(0, 1).toUpperCase()}</span><span><strong>{user.displayName}{owner ? " · Creator" : ""}</strong><small>@{user.handle}{user.role === "admin" ? " · Admin" : ""}</small></span></label>;
      })}</fieldset>
      <footer><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={saving} onClick={() => void submit()}>{saving ? "Saving…" : "Save members"}</button></footer>
    </section>
  </div>;
}
