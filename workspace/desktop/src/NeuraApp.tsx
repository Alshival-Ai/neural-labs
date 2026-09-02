import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  Globe2,
  Hash,
  Menu,
  LockKeyhole,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Send,
  Square,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { type ChangeEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { eventRecord, eventText, messagesFromSessionEvent, NeuraGateway } from "./openclaw";
import { readDeviceState, writeDeviceState } from "./deviceState";
import { createWorkspaceFolder, uploadWorkspaceFile, workspaceDownloadUrl, workspacePreviewUrl } from "./filesApi";
import { teamChatApi, teamSocketUrl, type TeamAttachment, type TeamChannel, type TeamDirectoryUser, type TeamMessage } from "./teamChat";
import type {
  ComposerAttachment,
  ConnectionState,
  GatewayEvent,
  NeuraActivity,
  NeuraApproval,
  NeuraMessage,
  SessionRow,
} from "./types";

type Props = {
  gateway: NeuraGateway;
  notify: (message: string) => void;
  storageNamespace?: string;
  storageArea?: string;
  composeRequest?: { id: string; text: string };
  csrfToken?: string;
  currentUser?: { id: string; handle: string; displayName: string; role: "admin" | "user" };
};

type NeuraDeviceState = { selectedKey?: string; selectedChannelId?: string; sidebarOpen: boolean; showArchived: boolean };
type SkillSuggestion = { key: string; name: string; description: string };
type SkillTrigger = { start: number; end: number; query: string };

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
  return `$${skill.key.replaceAll("-", "_")}`;
}

function neuraDeviceState(storageNamespace: string | undefined, storageArea: string): NeuraDeviceState {
  const stored = readDeviceState(storageNamespace, storageArea);
  if (!stored || typeof stored !== "object") return { sidebarOpen: true, showArchived: false };
  const value = stored as Record<string, unknown>;
  return {
    selectedKey: typeof value.selectedKey === "string" ? value.selectedKey.slice(0, 500) : undefined,
    selectedChannelId: typeof value.selectedChannelId === "string" ? value.selectedChannelId.slice(0, 100) : undefined,
    sidebarOpen: value.sidebarOpen !== false,
    showArchived: value.showArchived === true,
  };
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

export function resolveNeuraMessageLink(href: string | undefined, message: string): string | undefined {
  if (!href) return href;
  let url: URL;
  try {
    url = new URL(href, "https://neural-labs.invalid");
  } catch {
    return href;
  }
  if (!["http:", "https:"].includes(url.protocol) || !LOOPBACK_PREVIEW_HOSTS.has(url.hostname)) return href;

  const website = websiteEntryFromMessage(message);
  if (!website) return href;
  const requestedEntry = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const preview = workspacePreviewUrl(website.root, requestedEntry || website.entry);
  return preview ? `${preview}${url.search}${url.hash}` : href;
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
    const optimisticDuplicate = (message.id.startsWith("local:") || message.id.startsWith("run:")) && history.some((persisted) =>
      persisted.role === message.role && persisted.text === message.text);
    if (!optimisticDuplicate) merged.push(message);
  }
  return merged;
}

function reconcilePersistedMessage(current: NeuraMessage[], message: NeuraMessage, runId?: string): NeuraMessage[] {
  let optimisticUserRemoved = false;
  const next = current.filter((candidate) => {
    if (candidate.id === message.id) return false;
    if (runId && message.role === "assistant" && candidate.id === `run:${runId}`) return false;
    if (!optimisticUserRemoved && message.role === "user" && candidate.role === "user" && candidate.id.startsWith("local:") && candidate.text === message.text) {
      optimisticUserRemoved = true;
      return false;
    }
    return true;
  });
  return [...next, message];
}

const unavailableTeamUser = { id: "", handle: "user", displayName: "User", role: "user" as const };

export function NeuraApp({ gateway, notify, storageNamespace, storageArea = "neura", composeRequest, csrfToken = "", currentUser = unavailableTeamUser }: Props) {
  const [initialUiState] = useState(() => neuraDeviceState(storageNamespace, storageArea));
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [connectionError, setConnectionError] = useState<string>();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | undefined>(initialUiState.selectedKey);
  const [selectedChannelId, setSelectedChannelId] = useState<string | undefined>(initialUiState.selectedChannelId);
  const [teamChannels, setTeamChannels] = useState<TeamChannel[]>([]);
  const [teamDirectory, setTeamDirectory] = useState<TeamDirectoryUser[]>([]);
  const [teamMessages, setTeamMessages] = useState<TeamMessage[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamDirectoryUser[]>([]);
  const [teamConnection, setTeamConnection] = useState<ConnectionState>("connecting");
  const [teamAgentBusy, setTeamAgentBusy] = useState(false);
  const [teamTyping, setTeamTyping] = useState<TeamDirectoryUser[]>([]);
  const [teamDraft, setTeamDraft] = useState("");
  const [teamAttachments, setTeamAttachments] = useState<TeamAttachment[]>([]);
  const [teamDialog, setTeamDialog] = useState<{ source?: SessionRow } | undefined>();
  const [manageChannel, setManageChannel] = useState<TeamChannel | undefined>();
  const [messages, setMessages] = useState<NeuraMessage[]>([]);
  const [activities, setActivities] = useState<NeuraActivity[]>([]);
  const [approvals, setApprovals] = useState<NeuraApproval[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [runId, setRunId] = useState<string>();
  const [sidebarOpen, setSidebarOpen] = useState(initialUiState.sidebarOpen);
  const [mobileDrawer, setMobileDrawer] = useState(false);
  const [showArchived, setShowArchived] = useState(initialUiState.showArchived);
  const [creatingSession, setCreatingSession] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [skills, setSkills] = useState<SkillSuggestion[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillTrigger, setSkillTrigger] = useState<SkillTrigger | null>(null);
  const [skillMenuIndex, setSkillMenuIndex] = useState(0);
  const selectedKeyRef = useRef(selectedKey);
  const subscribedKeyRef = useRef<string | undefined>(undefined);
  const sessionsRequestRef = useRef(0);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const teamFileInput = useRef<HTMLInputElement>(null);
  const teamSocket = useRef<WebSocket | undefined>(undefined);
  const teamReconnect = useRef<number | undefined>(undefined);
  const teamTypingTimer = useRef<number | undefined>(undefined);
  const selectedChannelRef = useRef(selectedChannelId);
  const lastComposeRequest = useRef<string | undefined>(undefined);
  const selected = sessions.find((session) => session.key === selectedKey);
  const selectedChannel = teamChannels.find((channel) => channel.id === selectedChannelId);

  selectedKeyRef.current = selectedKey;
  selectedChannelRef.current = selectedChannelId;

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
          } else if (value.type === "message.created" && value.channelId === selectedChannelRef.current && value.message) {
            const message = value.message as TeamMessage;
            setTeamMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
          } else if (value.type === "channels.changed") {
            void refreshTeamChannels();
          } else if (value.type === "agent.status" && value.channelId === selectedChannelRef.current) {
            const run = value.run as { status?: string } | undefined;
            setTeamAgentBusy(run?.status === "queued" || run?.status === "running");
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
    setTeamAgentBusy(false);
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
    if (connection !== "connected") return;
    let active = true;
    setSkillsLoaded(false);
    void gateway.readSkillsStatus()
      .then((status) => {
        if (!active) return;
        setSkills(skillSuggestionsFromStatus(status));
        setSkillsLoaded(true);
      })
      .catch(() => {
        if (active) setSkillsLoaded(true);
      });
    return () => { active = false; };
  }, [connection, gateway]);

  useEffect(() => {
    if (!selectedKey || selectedChannelId || connection !== "connected") {
      setSessionReady(false);
      setMessages([]);
      return;
    }
    let active = true;
    let subscription: Awaited<ReturnType<NeuraGateway["subscribeSession"]>> | undefined;
    setSessionReady(false);
    setMessages([]);
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
    setActivities([]);
    setApprovals((current) => current.filter((approval) => !approval.sessionKey || approval.sessionKey === selectedKey));
    setMobileDrawer(false);
    return () => {
      active = false;
      subscribedKeyRef.current = undefined;
      if (subscription) void gateway.unsubscribeSession(subscription);
    };
  }, [selectedKey, selectedChannelId, connection]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ block: "end" });
  }, [messages, teamMessages, activities, approvals]);

  useEffect(() => {
    writeDeviceState(storageNamespace, storageArea, { selectedKey, selectedChannelId, sidebarOpen, showArchived } satisfies NeuraDeviceState);
  }, [selectedKey, selectedChannelId, showArchived, sidebarOpen, storageArea, storageNamespace]);

  function handleGatewayEvent(event: GatewayEvent) {
    const payload = eventRecord(event);
    if (!payload) return;
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
      for (const message of persisted.messages) {
        setMessages((current) => reconcilePersistedMessage(current, message, persisted.runId));
      }
      if ((persisted.runId && persisted.messages.some((message) => message.role === "assistant")) || ["end", "error"].includes(persisted.phase ?? "")) {
        setRunId((current) => !persisted.runId || current === persisted.runId ? undefined : current);
      }
      void refreshSessions();
      return;
    }
    const sessionKey = recordString(payload, "sessionKey");
    if (!sessionKey || sessionKey !== selectedKeyRef.current && sessionKey !== subscribedKeyRef.current) return;
    if (event.event === "chat") {
      const state = recordString(payload, "state");
      const eventRunId = recordString(payload, "runId") ?? "active";
      if (state === "status") {
        setRunId(eventRunId);
        const phase = (recordString(payload, "phase") ?? "Starting Neura").replaceAll("_", " ");
        setActivities((current) => [...current.filter((item) => item.id !== `status:${eventRunId}`), {
          id: `status:${eventRunId}`, sessionKey, title: phase, state: "running",
        }]);
      }
      if (state === "delta") {
        setRunId(eventRunId);
        const delta = recordString(payload, "deltaText") ?? "";
        setMessages((current) => {
          const id = `run:${eventRunId}`;
          const existing = current.find((message) => message.id === id);
          const text = payload.replace === true ? delta : `${existing?.text ?? ""}${delta}`;
          return [...current.filter((message) => message.id !== id), { id, role: "assistant", text, pending: true }];
        });
      }
      if (["final", "aborted", "error"].includes(state ?? "")) {
        setRunId(undefined);
        const finalText = eventText(payload.message);
        setMessages((current) => {
          const id = `run:${eventRunId}`;
          if (!current.some((message) => message.id === id) && finalText) {
            if (current.some((message) => message.role === "assistant" && message.text === finalText)) return current;
            return [...current, { id, role: "assistant", text: finalText, pending: false }];
          }
          return current.map((message) => message.id === id
            ? { ...message, text: finalText || message.text, pending: false }
            : message);
        });
        setActivities((current) => current.map((item) => item.sessionKey === sessionKey && item.state === "running"
          ? { ...item, state: state === "error" ? "error" : "done" }
          : item));
        if (state === "error") {
          const rawError = recordString(payload, "errorMessage") ?? "Neura could not finish that request";
          const displayError = /401|missing bearer|authentication/i.test(rawError)
            ? "Neura is not signed in to its model provider yet. An administrator needs to complete OpenClaw model setup."
            : rawError;
          setMessages((current) => current.some((message) => message.id === `error:${eventRunId}`)
            ? current
            : [...current, { id: `error:${eventRunId}`, role: "system", text: displayError }]);
          notify(displayError);
        }
        void refreshSessions();
      }
      return;
    }
    if (event.event === "session.tool" || event.event === "session.operation") {
      const id = recordString(payload, "id") ?? recordString(payload, "toolCallId") ?? crypto.randomUUID();
      const stateValue = recordString(payload, "state") ?? recordString(payload, "status") ?? "running";
      const state = ["error", "failed"].includes(stateValue) ? "error" : ["done", "completed", "result"].includes(stateValue) ? "done" : "running";
      setActivities((current) => [...current.filter((item) => item.id !== id), {
        id,
        sessionKey,
        title: recordString(payload, "title") ?? recordString(payload, "toolName") ?? recordString(payload, "name") ?? "Working",
        detail: recordString(payload, "summary") ?? recordString(payload, "detail"),
        state,
      }]);
    }
  }

  const visibleSessions = useMemo(
    () => sessions.filter((session) => session.archived === showArchived),
    [sessions, showArchived],
  );
  const privateSessions = visibleSessions.filter((session) => session.visibility === "draft");
  const pinnedTeamChannels = teamChannels.filter((channel) => channel.pinned);
  const regularTeamChannels = teamChannels.filter((channel) => !channel.pinned);
  const matchingSkills = useMemo(() => {
    if (!skillTrigger) return [];
    const query = skillTrigger.query.toLowerCase().replaceAll("_", "-");
    return skills
      .filter((skill) => !query || `${skill.key} ${skill.name}`.toLowerCase().replaceAll("_", "-").includes(query))
      .sort((left, right) => {
        const leftStarts = left.key.toLowerCase().startsWith(query) || left.name.toLowerCase().startsWith(query);
        const rightStarts = right.key.toLowerCase().startsWith(query) || right.name.toLowerCase().startsWith(query);
        return Number(rightStarts) - Number(leftStarts) || left.name.localeCompare(right.name);
      })
      .slice(0, 10);
  }, [skillTrigger, skills]);

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

  const sendTeamMessage = () => {
    const body = teamDraft.trim();
    if (!selectedChannel || (!body && teamAttachments.length === 0)) return;
    const socket = teamSocket.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      notify("Team Chat is reconnecting. Your draft has been kept.");
      return;
    }
    socket.send(JSON.stringify({
      type: "post",
      channelId: selectedChannel.id,
      clientRequestId: crypto.randomUUID(),
      body,
      attachments: teamAttachments,
    }));
    socket.send(JSON.stringify({ type: "typing", channelId: selectedChannel.id, active: false }));
    setTeamDraft("");
    setTeamAttachments([]);
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

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const accepted = files.filter((file) => file.size <= 15 * 1024 * 1024);
    if (accepted.length !== files.length) notify("Files must be 15 MB or smaller.");
    setAttachments((current) => [...current, ...accepted.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    }))]);
    event.target.value = "";
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const match = current.find((attachment) => attachment.id === id);
      if (match?.previewUrl) URL.revokeObjectURL(match.previewUrl);
      return current.filter((attachment) => attachment.id !== id);
    });
  };

  const sendMessage = async (queueMode: "steer" | "followup" = "steer") => {
    const message = draft.trim();
    if (!selected || !sessionReady || (!message && attachments.length === 0) || connection !== "connected") return;
    const outgoing = attachments;
    setDraft("");
    setSkillTrigger(null);
    setAttachments([]);
    setMessages((current) => [...current, {
      id: `local:${crypto.randomUUID()}`,
      role: "user",
      text: message || outgoing.map((attachment) => attachment.file.name).join(", "),
      attachments: outgoing.map((attachment) => ({ name: attachment.file.name, type: attachment.file.type, url: attachment.previewUrl })),
    }]);
    try {
      const result = await gateway.send(selected, message, outgoing, runId ? queueMode : "steer");
      if (result.runId) setRunId(result.runId);
      for (const attachment of outgoing) if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    } catch (error) {
      setDraft(message);
      notify(error instanceof Error ? error.message : "Neura could not send that message");
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
    void sendMessage(event.ctrlKey || event.metaKey ? "followup" : "steer");
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
          <button type="button" className="sidebar-toggle" onClick={() => window.innerWidth <= 760 ? setMobileDrawer(true) : setSidebarOpen(true)} aria-label="Open conversation history">
            {window.innerWidth <= 760 ? <Menu /> : <PanelLeftOpen />}
          </button>
          <div>
            <strong>{selectedChannel ? `# ${selectedChannel.name}` : selected?.title ?? "Neura"}</strong>
            <span className={`connection connection-${selectedChannel ? teamConnection : connection}`}>
              {selectedChannel
                ? teamConnection === "connected" ? `${selectedChannel.memberCount} members · live` : teamConnection
                : connection === "connected" ? selected && !sessionReady ? "Syncing conversation" : "Connected through OpenClaw" : connection}
            </span>
          </div>
          {selectedChannel && selectedChannel.canManage && selectedChannel.audience === "restricted" && <button type="button" className="team-members-button" onClick={() => void openMemberManager(selectedChannel)}><Users />{teamMembers.length || selectedChannel.memberCount}</button>}
        </header>

        <div className="message-scroll" aria-live="polite">
          {!selectedChannel && connection === "error" && <div className="connection-error"><strong>Neura is unavailable</strong><p>{connectionError ?? "The Gateway connection could not be established."}</p></div>}
          {selectedChannel && teamConnection === "error" && <div className="connection-error"><strong>Team Chat is reconnecting</strong><p>Messages remain safely stored. Live updates will resume automatically.</p></div>}
          {!selected && !selectedChannel && connection === "connected" && (
            <div className="neura-welcome">
              <div className="neura-orb">N</div>
              <h1>Work with Neura</h1>
              <p>Neura is your OpenClaw agent. New conversations are private to your account.</p>
              <button type="button" disabled={creatingSession} aria-busy={creatingSession} onClick={() => void createConversation()}><MessageSquarePlus /> {creatingSession ? "Creating…" : "Start a conversation"}</button>
            </div>
          )}
          {selected && !selectedChannel && messages.length === 0 && (
            <div className="neura-welcome compact"><div className="neura-orb">N</div><h1>What should we work on?</h1><p>{selected.visibility === "draft" ? "Only you can see and write in this conversation." : "This conversation is shared with your team."}</p></div>
          )}
          {!selectedChannel && messages.map((message) => (
            <article className={`message message-${message.role}`} key={message.id}>
              {message.role === "assistant" && <div className="message-avatar">N</div>}
              <div className="message-body">
                <span className="message-author">{message.role === "assistant" ? "Neura" : message.role === "user" ? "You" : "System"}</span>
                {message.attachments && <div className="message-attachments">{message.attachments.map((attachment) => attachment.url
                  ? <img key={attachment.name} src={attachment.url} alt={attachment.name} />
                  : <span key={attachment.name}><Paperclip />{attachment.name}</span>)}</div>}
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                  a: ({ href, children }) => {
                    const target = message.role === "assistant" ? resolveNeuraMessageLink(href, message.text) : href;
                    const preview = target !== href;
                    return <a href={target} target="_blank" rel="noreferrer" title={preview ? "Open website preview" : undefined}>{children}</a>;
                  },
                }}>{message.text}</ReactMarkdown>
                {message.pending && <span className="typing-cursor" aria-label="Neura is responding" />}
              </div>
            </article>
          ))}
          {selectedChannel && teamMessages.length === 0 && (
            <div className="neura-welcome compact"><div className="neura-orb"><Hash /></div><h1>#{selectedChannel.name}</h1><p>{selectedChannel.audience === "everyone" ? "Everyone with Neural Labs access can join this conversation." : "This is a private channel for invited teammates."} Type <strong>$Neura</strong> when you want the agent to join in.</p></div>
          )}
          {selectedChannel && teamMessages.map((message) => {
            const neura = message.authorKind === "neura" || message.authorKind === "imported_neura";
            const system = message.authorKind === "system";
            const author = neura ? "Neura" : system ? "System" : message.author?.displayName ?? "Former teammate";
            return <article className={`message team-message message-${neura ? "assistant" : system ? "system" : "user"}`} key={message.id}>
              {neura && <div className="message-avatar">N</div>}
              <div className="message-body">
                <span className="message-author">{author}{message.author && <small>@{message.author.handle}</small>}</span>
                {message.attachments.length > 0 && <div className="team-message-attachments">{message.attachments.map((attachment) => <a key={attachment.path} href={workspaceDownloadUrl(attachment.path)} download><Paperclip />{attachment.name}<small>{attachment.size ? `${Math.max(1, Math.round(attachment.size / 1024))} KB` : "Workspace file"}</small></a>)}</div>}
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.body}</ReactMarkdown>
                <time dateTime={message.createdAt}>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(message.createdAt))}</time>
              </div>
            </article>;
          })}
          <div ref={messagesEnd} />
        </div>

        {selectedChannel && (
          <footer className="neura-composer-area team-composer-area">
            {(teamAgentBusy || teamTyping.length > 0) && <div className="team-presence" role="status">
              {teamAgentBusy && <span><span className="activity-spinner" />Neura is working…</span>}
              {teamTyping.length > 0 && <span>{teamTyping.map((user) => `@${user.handle}`).join(", ")} {teamTyping.length === 1 ? "is" : "are"} typing…</span>}
            </div>}
            <div className="composer-shell">
              {teamAttachments.length > 0 && <div className="composer-attachments">{teamAttachments.map((attachment) => <div key={attachment.path}><Paperclip /><span>{attachment.name}</span><button type="button" onClick={() => setTeamAttachments((current) => current.filter((item) => item.path !== attachment.path))} aria-label={`Remove ${attachment.name}`}><X /></button></div>)}</div>}
              <div className="composer-row">
                <input ref={teamFileInput} type="file" multiple hidden onChange={(event) => void selectTeamFiles(event)} />
                <button type="button" className="attach-button" disabled={teamConnection !== "connected"} onClick={() => teamFileInput.current?.click()} aria-label="Attach workspace files"><Paperclip /></button>
                <textarea
                  value={teamDraft}
                  onChange={(event) => handleTeamDraft(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendTeamMessage(); } }}
                  rows={1}
                  placeholder={`Message #${selectedChannel.name} · $Neura calls the agent`}
                />
                <button type="button" className="send-button" onClick={sendTeamMessage} disabled={teamConnection !== "connected" || !teamDraft.trim() && teamAttachments.length === 0} aria-label="Send Team Chat message"><Send /></button>
              </div>
            </div>
            <p className="composer-hint">Enter to send · Shift+Enter for a new line · $Neura invites the agent · @handle mentions a teammate</p>
          </footer>
        )}

        {selected && !selectedChannel && (
          <footer className="neura-composer-area">
            {activities.length > 0 && <div className="activity-strip">{activities.slice(-3).map((activity) => (
              <div key={activity.id} className={`activity activity-${activity.state}`}>
                {activity.state === "running" ? <span className="activity-spinner" /> : activity.state === "done" ? <Check /> : <X />}
                <span><strong>{activity.title}</strong>{activity.detail && <small>{activity.detail}</small>}</span>
              </div>
            ))}</div>}
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
                <textarea
                  ref={composerInput}
                  disabled={!sessionReady}
                  value={draft}
                  onChange={(event) => { setDraft(event.target.value); syncSkillTrigger(event.target.value, event.target.selectionStart); }}
                  onClick={(event) => syncSkillTrigger(event.currentTarget.value, event.currentTarget.selectionStart)}
                  onBlur={() => window.setTimeout(() => setSkillTrigger(null), 100)}
                  onKeyDown={handleComposerKey}
                  rows={1}
                  placeholder={!sessionReady ? "Connecting conversation…" : runId ? "Steer Neura or queue a follow-up…" : "Message Neura…"}
                  aria-autocomplete="list"
                  aria-controls={skillTrigger ? "neura-skill-suggestions" : undefined}
                  aria-expanded={Boolean(skillTrigger)}
                  aria-activedescendant={skillTrigger && matchingSkills.length > 0 ? `neura-skill-option-${skillMenuIndex % matchingSkills.length}` : undefined}
                />
                {runId && <button type="button" className="stop-button" onClick={() => void gateway.abort(selected.key, runId)} aria-label="Stop Neura"><Square /></button>}
                <div className="split-send">
                  <button type="button" className="send-button" onClick={() => void sendMessage("steer")} disabled={!sessionReady || !draft.trim() && attachments.length === 0} aria-label={runId ? "Steer active run" : "Send message"}><Send /></button>
                  {runId && <details><summary aria-label="Send options"><ChevronDown /></summary><div><button type="button" onClick={() => void sendMessage("steer")}>Steer active run <kbd>Enter</kbd></button><button type="button" onClick={() => void sendMessage("followup")}>Queue follow-up <kbd>⌘↵</kbd></button></div></details>}
                </div>
              </div>
            </div>
            <p className="composer-hint">Enter to {runId ? "steer" : "send"} · Ctrl/Cmd+Enter to queue · Shift+Enter for a new line</p>
          </footer>
        )}
      </main>
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
