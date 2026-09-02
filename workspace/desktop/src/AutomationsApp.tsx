import {
  Activity,
  BellRing,
  Bot,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock3,
  Code2,
  Copy,
  ExternalLink,
  History,
  LoaderCircle,
  MessageSquareText,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  TimerReset,
  Trash2,
  TriangleAlert,
  Webhook,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import "./automations-app.css";

export type AutomationAccent = "cyan" | "violet" | "pink" | "coral" | "amber" | "mint";
export type AutomationScheduleKind = "at" | "every" | "cron" | "on-exit" | "stream";
export type AutomationPayloadKind = "systemEvent" | "agentTurn" | "command" | "script" | "heartbeat" | "skillCollectionReview";
export type AutomationDeliveryMode = "announce" | "webhook" | "none";
export type AutomationRunStatus = "ok" | "error" | "skipped" | "running";
export type AutomationRunMode = "force" | "due" | "if-enabled";

export type AutomationRun = {
  id: string;
  status: AutomationRunStatus;
  started: string;
  duration: string;
  summary: string;
  deliveryStatus: "delivered" | "not-delivered" | "not-requested" | "unknown" | "pending";
  model?: string;
  usage?: string;
  error?: string;
};

export type AutomationJob = {
  id: string;
  configRevision?: string;
  name: string;
  description: string;
  accent: AutomationAccent;
  enabled: boolean;
  running?: boolean;
  systemOwned?: boolean;
  deleteAfterRun?: boolean;
  autoDisabled?: { reason: "consecutive-failures" | "schedule-errors"; consecutiveErrors: number };
  schedule: {
    kind: AutomationScheduleKind;
    label: string;
    detail: string;
    expression: string;
    timezone?: string;
    exact?: boolean;
    trigger?: string;
    pacing?: string;
    workingDirectory?: string;
  };
  payload: {
    kind: AutomationPayloadKind;
    label: string;
    content: string;
    model?: string;
    thinking?: string;
    tools?: readonly string[];
    timeout?: string;
    workingDirectory?: string;
  };
  sessionTarget: "main" | "isolated" | "current" | `session:${string}`;
  wakeMode: "now" | "next-heartbeat";
  agent: string;
  delivery: {
    mode: AutomationDeliveryMode;
    label: string;
    target?: string;
    channel?: string;
    bestEffort?: boolean;
  };
  nextRun: string;
  nextRunDetail: string;
  lastRun: string;
  lastStatus: Exclude<AutomationRunStatus, "running">;
  consecutiveErrors: number;
  runs: readonly AutomationRun[];
};

export type AutomationDraft = {
  name: string;
  description: string;
  scheduleKind: AutomationScheduleKind;
  scheduleValue: string;
  timezone: string;
  exact: boolean;
  triggerScript: string;
  pacingMin: string;
  pacingMax: string;
  payloadKind: Exclude<AutomationPayloadKind, "heartbeat" | "skillCollectionReview">;
  payload: string;
  workingDirectory: string;
  sessionTarget: AutomationJob["sessionTarget"];
  wakeMode: AutomationJob["wakeMode"];
  agent: string;
  deliveryMode: AutomationDeliveryMode;
  channel: string;
  target: string;
  model: string;
  thinking: string;
  tools: string;
  timeoutSeconds: string;
  failureAlertAfter: string;
};

export type AutomationsAppProps = {
  jobs?: readonly AutomationJob[];
  workspaceName?: string;
  schedulerOnline?: boolean;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void | Promise<void>;
  onCreate?: (draft: AutomationDraft) => void | Promise<void>;
  onUpdate?: (job: AutomationJob, draft: AutomationDraft) => void | Promise<void>;
  onToggle?: (job: AutomationJob, enabled: boolean) => void | Promise<void>;
  onRun?: (job: AutomationJob, mode: AutomationRunMode) => void | Promise<void>;
  onDelete?: (job: AutomationJob) => void | Promise<void>;
  onInspectRun?: (job: AutomationJob, run: AutomationRun) => void;
};

// Prototype-only records modeled after OpenClaw's current automation schema.
export const PLACEHOLDER_AUTOMATIONS: readonly AutomationJob[] = [
  {
    id: "morning-brief",
    name: "Morning team brief",
    description: "Summarize overnight work and post the useful changes to the product channel.",
    accent: "cyan",
    enabled: true,
    schedule: { kind: "cron", label: "Weekdays at 7:00 AM", detail: "0 7 * * 1-5", expression: "0 7 * * 1-5", timezone: "America/Chicago", exact: true },
    payload: { kind: "agentTurn", label: "Agent message", content: "Summarize overnight workspace changes. Lead with anything blocked and keep links intact.", model: "openai/gpt-5.6-luna", thinking: "low", tools: ["read", "sessions_list"], timeout: "10 min" },
    sessionTarget: "isolated",
    wakeMode: "now",
    agent: "main",
    delivery: { mode: "announce", label: "Announce", target: "Slack · #product", bestEffort: false },
    nextRun: "Tomorrow · 7:00 AM",
    nextRunDetail: "in 14 hr 42 min",
    lastRun: "Today · 7:00 AM",
    lastStatus: "ok",
    consecutiveErrors: 0,
    runs: [
      { id: "brief-091", status: "ok", started: "Today · 7:00 AM", duration: "38s", summary: "Delivered a six-item overnight brief with two follow-ups.", deliveryStatus: "delivered", model: "gpt-5.6-luna", usage: "8.4k tokens" },
      { id: "brief-090", status: "ok", started: "Yesterday · 7:00 AM", duration: "41s", summary: "Delivered the overnight product and infrastructure summary.", deliveryStatus: "delivered", model: "gpt-5.6-luna", usage: "9.1k tokens" },
      { id: "brief-089", status: "skipped", started: "Aug 29 · 7:00 AM", duration: "2s", summary: "Local model endpoint was unavailable during preflight.", deliveryStatus: "not-requested", model: "gpt-5.6-luna" },
    ],
  },
  {
    id: "pr-watcher",
    name: "PR checks watcher",
    description: "Watch the release pull request and ask Neura to investigate when CI state changes.",
    accent: "violet",
    enabled: false,
    autoDisabled: { reason: "consecutive-failures", consecutiveErrors: 10 },
    schedule: { kind: "every", label: "Every 2 minutes", detail: "Condition watcher", expression: "2m", trigger: "Fire when the observed CI state changes", pacing: "2m–15m" },
    payload: { kind: "agentTurn", label: "Agent message", content: "Investigate the changed CI state and report the smallest useful next action.", model: "Workspace default", thinking: "medium", tools: ["exec", "read"], timeout: "8 min" },
    sessionTarget: "isolated",
    wakeMode: "now",
    agent: "release",
    delivery: { mode: "announce", label: "Announce", target: "Current conversation" },
    nextRun: "Paused",
    nextRunDetail: "auto-disabled",
    lastRun: "Today · 4:18 PM",
    lastStatus: "error",
    consecutiveErrors: 10,
    runs: [
      { id: "pr-204", status: "error", started: "Today · 4:18 PM", duration: "30s", summary: "Condition evaluation did not complete.", deliveryStatus: "not-requested", error: "Trigger evaluation timed out after 30 seconds." },
      { id: "pr-203", status: "error", started: "Today · 4:16 PM", duration: "11s", summary: "The checks provider returned an overloaded response.", deliveryStatus: "not-requested", error: "Provider overloaded; recurring backoff is active." },
      { id: "pr-202", status: "ok", started: "Today · 4:14 PM", duration: "4s", summary: "No state change; payload was not fired.", deliveryStatus: "not-requested" },
    ],
  },
  {
    id: "release-exit",
    name: "Release completion",
    description: "Fire once when the supervised release command exits and prepare a deployment summary.",
    accent: "pink",
    enabled: true,
    schedule: { kind: "on-exit", label: "When release exits", detail: "./scripts/release-watch.sh", expression: "./scripts/release-watch.sh" },
    payload: { kind: "agentTurn", label: "Agent message", content: "Review the completed release output and summarize changes, warnings, and rollback notes.", model: "Workspace default", thinking: "medium", tools: ["read"], timeout: "15 min" },
    sessionTarget: "current",
    wakeMode: "now",
    agent: "main",
    delivery: { mode: "announce", label: "Announce", target: "Bound release conversation" },
    nextRun: "Watching process",
    nextRunDetail: "started 22 min ago",
    lastRun: "Aug 28 · 2:42 PM",
    lastStatus: "ok",
    consecutiveErrors: 0,
    runs: [
      { id: "release-017", status: "ok", started: "Aug 28 · 2:42 PM", duration: "1m 12s", summary: "Release finished and the deployment summary was committed to the conversation.", deliveryStatus: "delivered", usage: "12.2k tokens" },
    ],
  },
  {
    id: "build-stream",
    name: "Build event stream",
    description: "Batch matching build events from a supervised process and triage failures as they arrive.",
    accent: "coral",
    enabled: true,
    running: true,
    schedule: { kind: "stream", label: "Live event stream", detail: "match · ^(failed|recovered):", expression: "node scripts/build-events.mjs", trigger: "250 ms quiet window" },
    payload: { kind: "agentTurn", label: "Agent message", content: "Investigate this batch of build events. Reply only when the team needs to act.", model: "openai/gpt-5.6-luna", thinking: "low", tools: ["read", "exec"], timeout: "5 min" },
    sessionTarget: "isolated",
    wakeMode: "now",
    agent: "build",
    delivery: { mode: "none", label: "No fallback delivery" },
    nextRun: "Listening now",
    nextRunDetail: "source healthy",
    lastRun: "Today · 3:52 PM",
    lastStatus: "ok",
    consecutiveErrors: 0,
    runs: [
      { id: "stream-662", status: "running", started: "Today · 4:19 PM", duration: "18s", summary: "Processing a two-event batch.", deliveryStatus: "pending", model: "gpt-5.6-luna" },
      { id: "stream-661", status: "ok", started: "Today · 3:52 PM", duration: "21s", summary: "A recovered build event was recorded; no announcement was needed.", deliveryStatus: "not-requested", model: "gpt-5.6-luna", usage: "2.1k tokens" },
    ],
  },
  {
    id: "launch-reminder",
    name: "Launch readiness reminder",
    description: "Place a one-time reminder into the main session before the release review.",
    accent: "amber",
    enabled: true,
    deleteAfterRun: true,
    schedule: { kind: "at", label: "Sep 3 at 9:30 AM", detail: "One shot · delete after success", expression: "2026-09-03T09:30:00-05:00", timezone: "America/Chicago" },
    payload: { kind: "systemEvent", label: "System event", content: "Reminder: review launch readiness and unresolved owner assignments." },
    sessionTarget: "main",
    wakeMode: "next-heartbeat",
    agent: "main",
    delivery: { mode: "none", label: "Main session only" },
    nextRun: "Sep 3 · 9:30 AM",
    nextRunDetail: "in 1 day 17 hr",
    lastRun: "Never",
    lastStatus: "skipped",
    consecutiveErrors: 0,
    runs: [],
  },
  {
    id: "skills-review",
    name: "Shared skills review",
    description: "OpenClaw-managed review of writable workspace skills and proposed improvements.",
    accent: "mint",
    enabled: false,
    systemOwned: true,
    schedule: { kind: "every", label: "Every 7 days", detail: "System managed", expression: "7d" },
    payload: { kind: "skillCollectionReview", label: "Skill collection review", content: "System-owned OpenClaw payload" },
    sessionTarget: "isolated",
    wakeMode: "now",
    agent: "main",
    delivery: { mode: "none", label: "No delivery" },
    nextRun: "Paused",
    nextRunDetail: "requires review",
    lastRun: "Never",
    lastStatus: "skipped",
    consecutiveErrors: 0,
    runs: [],
  },
];

const EMPTY_DRAFT: AutomationDraft = {
  name: "",
  description: "",
  scheduleKind: "cron",
  scheduleValue: "0 9 * * 1-5",
  timezone: "America/Chicago",
  exact: false,
  triggerScript: "",
  pacingMin: "",
  pacingMax: "",
  payloadKind: "agentTurn",
  payload: "",
  workingDirectory: "/home/node/workspace",
  sessionTarget: "isolated",
  wakeMode: "now",
  agent: "main",
  deliveryMode: "announce",
  channel: "last",
  target: "Current conversation",
  model: "Workspace default",
  thinking: "medium",
  tools: "read",
  timeoutSeconds: "600",
  failureAlertAfter: "2",
};

const SCHEDULE_META: Record<AutomationScheduleKind, { label: string; description: string; icon: LucideIcon }> = {
  at: { label: "One time", description: "At a date", icon: CalendarClock },
  every: { label: "Interval", description: "Every duration", icon: TimerReset },
  cron: { label: "Cron", description: "Calendar rule", icon: Clock3 },
  "on-exit": { label: "On exit", description: "Process event", icon: TerminalSquare },
  stream: { label: "Stream", description: "Live lines", icon: Radio },
};

const PAYLOAD_META: Record<AutomationDraft["payloadKind"], { label: string; icon: LucideIcon }> = {
  systemEvent: { label: "System event", icon: BellRing },
  agentTurn: { label: "Agent message", icon: Bot },
  command: { label: "Command", icon: TerminalSquare },
  script: { label: "Script", icon: Code2 },
};

function cloneJob(job: AutomationJob): AutomationJob {
  return { ...job, schedule: { ...job.schedule }, payload: { ...job.payload, tools: job.payload.tools ? [...job.payload.tools] : undefined }, delivery: { ...job.delivery }, runs: job.runs.map((run) => ({ ...run })) };
}

function statusLabel(status: AutomationRunStatus): string {
  if (status === "ok") return "Succeeded";
  if (status === "error") return "Failed";
  if (status === "running") return "Running";
  return "Skipped";
}

function payloadLabel(kind: AutomationPayloadKind): string {
  if (kind === "systemEvent") return "System event";
  if (kind === "agentTurn") return "Agent message";
  if (kind === "skillCollectionReview") return "Skill review";
  return kind[0].toUpperCase() + kind.slice(1);
}

function draftFromJob(job: AutomationJob): AutomationDraft {
  const payloadKind = job.payload.kind === "heartbeat" || job.payload.kind === "skillCollectionReview" ? "agentTurn" : job.payload.kind;
  return {
    ...EMPTY_DRAFT,
    name: job.name,
    description: job.description,
    scheduleKind: job.schedule.kind,
    scheduleValue: job.schedule.expression,
    timezone: job.schedule.timezone ?? EMPTY_DRAFT.timezone,
    exact: job.schedule.exact ?? false,
    triggerScript: job.schedule.trigger ?? "",
    payloadKind,
    payload: job.payload.content,
    workingDirectory: job.payload.workingDirectory ?? job.schedule.workingDirectory ?? EMPTY_DRAFT.workingDirectory,
    sessionTarget: job.sessionTarget,
    wakeMode: job.wakeMode,
    agent: job.agent,
    deliveryMode: job.delivery.mode,
    channel: job.delivery.channel ?? "last",
    target: job.delivery.target ?? "",
    model: job.payload.model ?? "Workspace default",
    thinking: job.payload.thinking ?? "medium",
    tools: job.payload.tools?.join(", ") ?? "",
    timeoutSeconds: job.payload.timeout?.replace(/\D/g, "") || "600",
    failureAlertAfter: String(Math.max(2, job.consecutiveErrors || 2)),
  };
}

export function AutomationsApp({
  jobs = PLACEHOLDER_AUTOMATIONS,
  workspaceName = "Workspace",
  schedulerOnline = true,
  loading = false,
  error,
  onRefresh,
  onCreate,
  onUpdate,
  onToggle,
  onRun,
  onDelete,
  onInspectRun,
}: AutomationsAppProps) {
  const [localJobs, setLocalJobs] = useState<AutomationJob[]>(() => jobs.map(cloneJob));
  const [selectedId, setSelectedId] = useState(() => jobs[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "paused" | "issues">("all");
  const [detailTab, setDetailTab] = useState<"overview" | "runs">("overview");
  const [expandedRunId, setExpandedRunId] = useState<string>();
  const [runMenuId, setRunMenuId] = useState<string>();
  const [actionMenuId, setActionMenuId] = useState<string>();
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<AutomationDraft>(EMPTY_DRAFT);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [pendingAction, setPendingAction] = useState<string>();

  useEffect(() => {
    setLocalJobs(jobs.map(cloneJob));
    setSelectedId((current) => jobs.some((job) => job.id === current) ? current : jobs[0]?.id ?? "");
  }, [jobs]);

  const selected = localJobs.find((job) => job.id === selectedId) ?? localJobs[0];
  const visibleJobs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return localJobs.filter((job) => {
      const matchesText = !normalized || `${job.name} ${job.description} ${job.schedule.label} ${job.payload.label}`.toLowerCase().includes(normalized);
      const matchesFilter = filter === "all"
        || (filter === "active" && job.enabled)
        || (filter === "paused" && !job.enabled)
        || (filter === "issues" && (job.lastStatus === "error" || Boolean(job.autoDisabled)));
      return matchesText && matchesFilter;
    });
  }, [filter, localJobs, query]);

  const activeCount = localJobs.filter((job) => job.enabled).length;
  const issueCount = localJobs.filter((job) => job.lastStatus === "error" || job.autoDisabled).length;
  const runningCount = localJobs.filter((job) => job.running || job.runs[0]?.status === "running").length;
  const terminalRuns = localJobs.flatMap((job) => job.runs).filter((run) => run.status !== "running");
  const successRate = terminalRuns.length ? Math.round((terminalRuns.filter((run) => run.status === "ok").length / terminalRuns.length) * 100) : 100;

  const chooseJob = (job: AutomationJob) => {
    setSelectedId(job.id);
    setDetailTab("overview");
    setExpandedRunId(undefined);
    setMobileDetail(true);
  };

  const toggleJob = async (job: AutomationJob) => {
    const enabled = !job.enabled;
    const next = { ...job, enabled, autoDisabled: enabled ? undefined : job.autoDisabled };
    setLocalJobs((current) => current.map((item) => item.id === job.id ? next : item));
    setPendingAction(`toggle:${job.id}`);
    try {
      await onToggle?.(job, enabled);
      setNotice(`${job.name} ${enabled ? "enabled" : "paused"}.`);
    } catch (reason) {
      setLocalJobs((current) => current.map((item) => item.id === job.id ? job : item));
      setNotice(reason instanceof Error ? reason.message : "OpenClaw rejected the state change.");
    } finally {
      setPendingAction(undefined);
    }
  };

  const runJob = async (job: AutomationJob, mode: AutomationRunMode) => {
    const run: AutomationRun = {
      id: `${job.id}-manual-${Date.now()}`,
      status: "running",
      started: "Just now",
      duration: "—",
      summary: mode === "due" ? "Checking whether this automation is due…" : mode === "if-enabled" ? "Checking whether this automation is enabled…" : "Manual run submitted to OpenClaw.",
      deliveryStatus: "pending",
      model: job.payload.model,
    };
    const next = { ...job, running: true, runs: [run, ...job.runs] };
    setLocalJobs((current) => current.map((item) => item.id === job.id ? next : item));
    setRunMenuId(undefined);
    setPendingAction(`run:${job.id}`);
    try {
      await onRun?.(job, mode);
      setNotice(`${job.name} ${mode === "due" ? "will run only if due" : mode === "if-enabled" ? "will run only if enabled" : "started now"}.`);
    } catch (reason) {
      setLocalJobs((current) => current.map((item) => item.id === job.id ? job : item));
      setNotice(reason instanceof Error ? reason.message : "OpenClaw rejected the run.");
    } finally {
      setPendingAction(undefined);
    }
  };

  const openCreate = () => {
    setEditingId(undefined);
    setDraft({ ...EMPTY_DRAFT });
    setComposerOpen(true);
  };

  const openEdit = (job: AutomationJob) => {
    setEditingId(job.id);
    setDraft(draftFromJob(job));
    setComposerOpen(true);
  };

  const submitDraft = async (event: FormEvent) => {
    event.preventDefault();
    const scheduleMeta = SCHEDULE_META[draft.scheduleKind];
    const payloadMeta = PAYLOAD_META[draft.payloadKind];
    const scheduleLabel = draft.scheduleKind === "cron" ? `Cron · ${draft.scheduleValue}`
      : draft.scheduleKind === "every" ? `Every ${draft.scheduleValue}`
      : draft.scheduleKind === "at" ? draft.scheduleValue
      : draft.scheduleKind === "on-exit" ? "When process exits"
      : "Live event stream";
    const nextJob: AutomationJob = {
      id: editingId ?? `automation-pending-${Date.now()}`,
      configRevision: editingId ? localJobs.find((job) => job.id === editingId)?.configRevision : undefined,
      name: draft.name.trim(),
      description: draft.description.trim() || "Team automation",
      accent: editingId ? (localJobs.find((job) => job.id === editingId)?.accent ?? "violet") : "violet",
      enabled: true,
      schedule: {
        kind: draft.scheduleKind,
        label: scheduleLabel,
        detail: scheduleMeta.description,
        expression: draft.scheduleValue,
        timezone: draft.scheduleKind === "cron" || draft.scheduleKind === "at" ? draft.timezone : undefined,
        exact: draft.scheduleKind === "cron" ? draft.exact : undefined,
        trigger: draft.triggerScript || undefined,
        pacing: draft.pacingMin || draft.pacingMax ? `${draft.pacingMin || "open"}–${draft.pacingMax || "open"}` : undefined,
      },
      payload: {
        kind: draft.payloadKind,
        label: payloadMeta.label,
        content: draft.payload,
        model: draft.payloadKind === "agentTurn" ? draft.model : undefined,
        thinking: draft.payloadKind === "agentTurn" ? draft.thinking : undefined,
        tools: draft.tools.split(",").map((tool) => tool.trim()).filter(Boolean),
        timeout: `${draft.timeoutSeconds || "600"} sec`,
      },
      sessionTarget: draft.sessionTarget,
      wakeMode: draft.wakeMode,
      agent: draft.agent,
      delivery: {
        mode: draft.deliveryMode,
        label: draft.deliveryMode === "announce" ? "Announce" : draft.deliveryMode === "webhook" ? "Webhook" : "No delivery",
        target: draft.deliveryMode === "none" ? undefined : draft.target,
      },
      nextRun: draft.scheduleKind === "stream" ? "Starts when enabled" : draft.scheduleKind === "on-exit" ? "Watching after save" : "Schedule pending",
      nextRunDetail: draft.timezone,
      lastRun: editingId ? (localJobs.find((job) => job.id === editingId)?.lastRun ?? "Never") : "Never",
      lastStatus: editingId ? (localJobs.find((job) => job.id === editingId)?.lastStatus ?? "skipped") : "skipped",
      consecutiveErrors: editingId ? (localJobs.find((job) => job.id === editingId)?.consecutiveErrors ?? 0) : 0,
      runs: editingId ? (localJobs.find((job) => job.id === editingId)?.runs ?? []) : [],
    };

    setPendingAction("save");
    try {
      if (editingId) {
        const original = localJobs.find((job) => job.id === editingId);
        if (!original) throw new Error("This automation changed. Refresh and try again.");
        await onUpdate?.(original, draft);
        setNotice(`${nextJob.name} updated.`);
      } else {
        await onCreate?.(draft);
        setNotice(`${nextJob.name} created and enabled.`);
      }
      setComposerOpen(false);
      setMobileDetail(true);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "OpenClaw rejected the automation.");
    } finally {
      setPendingAction(undefined);
    }
  };

  const deleteJob = async (job: AutomationJob) => {
    setActionMenuId(undefined);
    if (!window.confirm(`Remove “${job.name}”? Its run history will no longer appear with this job.`)) return;
    setPendingAction(`delete:${job.id}`);
    try {
      await onDelete?.(job);
      setNotice(`${job.name} removed.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "OpenClaw rejected the removal.");
    } finally {
      setPendingAction(undefined);
    }
  };

  const refreshJobs = async () => {
    setPendingAction("refresh");
    try {
      await onRefresh?.();
      setNotice("Automation state refreshed from OpenClaw.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "The automation state could not be refreshed.");
    } finally {
      setPendingAction(undefined);
    }
  };

  if (!selected) {
    return (
      <section className="automations-app automations-app--empty">
        {loading ? <LoaderCircle className="is-spinning" /> : error ? <TriangleAlert /> : <CalendarClock />}
        <strong>{loading ? "Connecting to OpenClaw" : error ? "Automations are unavailable" : "No automations yet"}</strong>
        <p>{loading ? "Loading the shared scheduler and durable run history…" : error ?? `Schedule the first shared workflow for ${workspaceName}.`}</p>
        {error ? <button type="button" onClick={() => void refreshJobs()} disabled={pendingAction === "refresh"}><RefreshCw />Try again</button> : !loading && <button type="button" onClick={openCreate}><Plus />New automation</button>}
        {composerOpen && <AutomationComposer draft={draft} editing={false} onChange={setDraft} onClose={() => setComposerOpen(false)} onSubmit={submitDraft} />}
      </section>
    );
  }

  return (
    <section className="automations-app" aria-label="Workspace automations">
      <header className="automations-toolbar">
        <div className="automations-toolbar__identity">
          <span><CalendarClock /></span><div><strong>Automations</strong><small>OpenClaw scheduler</small></div>
        </div>
        <div className={`automations-scheduler${schedulerOnline ? " is-online" : " is-offline"}`}>
          <i />
          <span><strong>{schedulerOnline ? "Scheduler online" : "Scheduler offline"}</strong><small>{schedulerOnline ? "Gateway is accepting jobs" : "Schedules will not fire"}</small></span>
        </div>
        <div className="automations-toolbar__actions">
          <button type="button" aria-label="Refresh automations" disabled={pendingAction === "refresh"} onClick={() => void refreshJobs()}><RefreshCw className={pendingAction === "refresh" ? "is-spinning" : undefined} /></button>
          <button type="button" onClick={openCreate}><Plus />New automation</button>
        </div>
      </header>

      <div className="automations-metrics" aria-label="Automation summary">
        <div className="is-cyan"><span><Zap /></span><div><strong>{activeCount}</strong><small>Enabled</small></div><em>of {localJobs.length}</em></div>
        <div className="is-violet"><span><LoaderCircle /></span><div><strong>{runningCount}</strong><small>Running now</small></div><em>{runningCount ? "live" : "quiet"}</em></div>
        <div className="is-coral"><span><TriangleAlert /></span><div><strong>{issueCount}</strong><small>Need attention</small></div><em>{issueCount ? "review" : "clear"}</em></div>
        <div className="is-mint"><span><CircleCheck /></span><div><strong>{successRate}%</strong><small>Recent success</small></div><em>{terminalRuns.length} runs</em></div>
      </div>

      <div className="automations-workspace">
        <aside className="automations-list" aria-label="Automation jobs">
          <div className="automations-list__heading">
            <div><span>Workspace</span><strong>{workspaceName}</strong></div><small>{localJobs.length} jobs</small>
          </div>
          <label className="automations-search"><Search /><span className="automations-sr-only">Search automations</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search automations" /></label>
          <div className="automations-filters" aria-label="Filter automations">
            {(["all", "active", "paused", "issues"] as const).map((value) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}
          </div>
          <div className="automations-job-list">
            {visibleJobs.map((job) => <AutomationJobCard key={job.id} job={job} selected={selected.id === job.id} onSelect={() => chooseJob(job)} onRun={() => void runJob(job, "force")} />)}
            {visibleJobs.length === 0 && <div className="automations-list__empty"><Search /><strong>No matching jobs</strong><span>Try another name or filter.</span></div>}
          </div>
          <footer className="automations-list__footer"><Activity /><span>History retained by OpenClaw</span><button type="button" onClick={() => void refreshJobs()}>Refresh</button></footer>
        </aside>

        <main className={`automations-detail${mobileDetail ? " is-mobile-open" : ""}`}>
          <header className="automation-detail-header">
            <button type="button" className="automation-detail-header__back" aria-label="Back to automations" onClick={() => setMobileDetail(false)}><ChevronRight /></button>
            <div className={`automation-detail-header__mark is-${selected.accent}`}><AutomationIcon kind={selected.schedule.kind} /></div>
            <div className="automation-detail-header__copy">
              <span>{selected.systemOwned ? "OpenClaw managed" : `${payloadLabel(selected.payload.kind)} · ${selected.agent}`}</span>
              <h1>{selected.name}</h1>
              <p>{selected.description}</p>
            </div>
            <label className="automation-toggle">
              <span>{selected.systemOwned ? "Managed" : selected.enabled ? "Enabled" : "Paused"}</span>
              <input type="checkbox" checked={selected.enabled} disabled={selected.systemOwned || pendingAction === `toggle:${selected.id}`} onChange={() => void toggleJob(selected)} aria-label={`${selected.enabled ? "Disable" : "Enable"} ${selected.name}`} />
              <i />
            </label>
            <div className="automation-detail-header__actions">
              <div className="automation-run-control">
                <button type="button" onClick={() => void runJob(selected, "force")} disabled={selected.running || pendingAction === `run:${selected.id}`}><Play />{selected.running || pendingAction === `run:${selected.id}` ? "Running" : "Run now"}</button>
                <button type="button" aria-label="Choose run mode" aria-expanded={runMenuId === selected.id} onClick={() => setRunMenuId((id) => id === selected.id ? undefined : selected.id)}><ChevronDown /></button>
                {runMenuId === selected.id && <div className="automation-run-menu"><button type="button" onClick={() => void runJob(selected, "force")}><Zap /><span><strong>Force run now</strong><small>Run regardless of schedule</small></span></button><button type="button" onClick={() => void runJob(selected, "due")}><Clock3 /><span><strong>Run only if due</strong><small>Respect the pending schedule</small></span></button><button type="button" onClick={() => void runJob(selected, "if-enabled")}><CircleCheck /><span><strong>Run if enabled</strong><small>Preserve an operator pause</small></span></button></div>}
              </div>
              <button type="button" onClick={() => openEdit(selected)} disabled={selected.systemOwned}><Settings2 />Edit</button>
              <div className="automation-more-control">
                <button type="button" aria-label="More automation actions" aria-expanded={actionMenuId === selected.id} onClick={() => setActionMenuId((id) => id === selected.id ? undefined : selected.id)}><MoreHorizontal /></button>
                {actionMenuId === selected.id && <div className="automation-more-menu"><button type="button" disabled={selected.systemOwned || pendingAction === `delete:${selected.id}`} onClick={() => void deleteJob(selected)}><Trash2 /><span><strong>Remove automation</strong><small>Delete the job from OpenClaw</small></span></button></div>}
              </div>
            </div>
          </header>

          {selected.autoDisabled && <div className="automation-warning"><ShieldAlert /><div><strong>Auto-disabled after {selected.autoDisabled.consecutiveErrors} failures</strong><span>OpenClaw stopped this recurring job as a safety backstop. Fix the cause, then enable it to clear the failure streak.</span></div><button type="button" onClick={() => void toggleJob(selected)}>Review and enable</button></div>}

          <nav className="automation-detail-tabs" aria-label="Automation details">
            <button type="button" aria-current={detailTab === "overview" ? "page" : undefined} onClick={() => setDetailTab("overview")}>Overview</button>
            <button type="button" aria-current={detailTab === "runs" ? "page" : undefined} onClick={() => setDetailTab("runs")}>Run history <span>{selected.runs.length}</span></button>
          </nav>

          <div className="automation-detail-scroll">
            {detailTab === "overview" ? (
              <AutomationOverview job={selected} onShowRuns={() => setDetailTab("runs")} onCopy={() => void navigator.clipboard.writeText(selected.id).then(() => setNotice(`Copied ${selected.id}.`), () => setNotice("The job ID could not be copied."))} />
            ) : (
              <AutomationRuns job={selected} expandedRunId={expandedRunId} onExpand={(run) => { setExpandedRunId((id) => id === run.id ? undefined : run.id); onInspectRun?.(selected, run); }} />
            )}
          </div>
        </main>
      </div>

      {notice && <div className="automations-notice" role="status"><Check /><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice(undefined)}><X /></button></div>}
      {composerOpen && <AutomationComposer draft={draft} editing={Boolean(editingId)} onChange={setDraft} onClose={() => setComposerOpen(false)} onSubmit={submitDraft} />}
    </section>
  );
}

function AutomationIcon({ kind }: { kind: AutomationScheduleKind }) {
  const Icon = SCHEDULE_META[kind].icon;
  return <Icon />;
}

function AutomationJobCard({ job, selected, onSelect, onRun }: { job: AutomationJob; selected: boolean; onSelect: () => void; onRun: () => void }) {
  return (
    <article className={`automation-job is-${job.accent}${selected ? " is-selected" : ""}${!job.enabled ? " is-paused" : ""}`}>
      <button type="button" className="automation-job__select" aria-label={job.name} aria-pressed={selected} onClick={onSelect}>
        <span className="automation-job__top"><i /><strong>{job.name}</strong>{job.systemOwned && <em>system</em>}</span>
        <span className="automation-job__schedule"><AutomationIcon kind={job.schedule.kind} />{job.schedule.label}</span>
        <span className="automation-job__status">
          <small className={`is-${job.running ? "running" : job.lastStatus}`}><i />{job.running ? "Running" : job.enabled ? statusLabel(job.lastStatus) : "Paused"}</small>
          <small>{job.nextRun}</small>
        </span>
      </button>
      <button type="button" className="automation-job__run" aria-label={`Run ${job.name} now`} disabled={job.running} onClick={onRun}><Play /></button>
    </article>
  );
}

function AutomationOverview({ job, onShowRuns, onCopy }: { job: AutomationJob; onShowRuns: () => void; onCopy: () => void }) {
  return (
    <div className="automation-overview">
      <section className="automation-schedule-card">
        <div className="automation-card-heading"><div><span>Trigger</span><h2>{job.schedule.label}</h2><p>{job.schedule.detail}</p></div><div className={`automation-kind-mark is-${job.accent}`}><AutomationIcon kind={job.schedule.kind} /></div></div>
        <div className="automation-timeline" aria-label={`Next run ${job.nextRun}`}>
          <span><i /><small>Last run</small><strong>{job.lastRun}</strong></span>
          <div>{[0, 1, 2, 3, 4, 5, 6].map((tick) => <i className={tick === 5 ? "is-next" : ""} key={tick} />)}</div>
          <span><i /><small>Next</small><strong>{job.nextRun}</strong></span>
        </div>
        <dl className="automation-detail-list">
          <div><dt>Schedule type</dt><dd>{SCHEDULE_META[job.schedule.kind].label}</dd></div>
          <div><dt>Definition</dt><dd><code>{job.schedule.expression}</code></dd></div>
          {job.schedule.timezone && <div><dt>Timezone</dt><dd>{job.schedule.timezone}</dd></div>}
          {job.schedule.pacing && <div><dt>Dynamic pacing</dt><dd>{job.schedule.pacing}</dd></div>}
          {job.schedule.trigger && <div><dt>Condition</dt><dd>{job.schedule.trigger}</dd></div>}
        </dl>
      </section>

      <section className="automation-payload-card">
        <div className="automation-card-heading"><div><span>Action</span><h2>{job.payload.label}</h2><p>{job.sessionTarget === "isolated" ? "Runs unattended in a dedicated session." : `Runs in ${job.sessionTarget.replace("session:", "session ")}.`}</p></div><div className={`automation-kind-mark is-${job.accent}`}><PayloadIcon kind={job.payload.kind} /></div></div>
        <div className="automation-payload-copy"><span>{payloadLabel(job.payload.kind)}</span><p>{job.payload.content}</p></div>
        <dl className="automation-detail-list is-grid">
          <div><dt>Agent</dt><dd>{job.agent}</dd></div>
          <div><dt>Session</dt><dd>{job.sessionTarget}</dd></div>
          <div><dt>Model</dt><dd>{job.payload.model ?? "Not applicable"}</dd></div>
          <div><dt>Thinking</dt><dd>{job.payload.thinking ?? "Not applicable"}</dd></div>
          <div><dt>Tools</dt><dd>{job.payload.tools?.join(", ") || "None"}</dd></div>
          <div><dt>Timeout</dt><dd>{job.payload.timeout ?? "Runtime default"}</dd></div>
        </dl>
      </section>

      <section className="automation-route-card">
        <div className="automation-card-heading"><div><span>Execution path</span><h2>From trigger to delivery</h2><p>The resolved route OpenClaw will use for the next run.</p></div><Route /></div>
        <div className="automation-route">
          <div className={`is-${job.accent}`}><AutomationIcon kind={job.schedule.kind} /><span><small>Trigger</small><strong>{SCHEDULE_META[job.schedule.kind].label}</strong></span></div><ChevronRight />
          <div className={`is-${job.accent}`}><PayloadIcon kind={job.payload.kind} /><span><small>Payload</small><strong>{payloadLabel(job.payload.kind)}</strong></span></div><ChevronRight />
          <div className={`is-${job.accent}`}><DeliveryIcon mode={job.delivery.mode} /><span><small>Delivery</small><strong>{job.delivery.label}</strong></span></div>
        </div>
        <div className="automation-route__target"><span><strong>{job.delivery.target ?? "No fallback destination"}</strong><small>{job.delivery.bestEffort ? "Best effort" : job.delivery.mode === "none" ? "Completion is logged" : "Required delivery"}</small></span><span><strong>Wake mode</strong><small>{job.wakeMode}</small></span></div>
      </section>

      <section className="automation-recent-card">
        <div className="automation-card-heading"><div><span>Recent activity</span><h2>Latest runs</h2><p>Execution and delivery are tracked separately.</p></div><button type="button" onClick={onShowRuns}>View all <ChevronRight /></button></div>
        <div className="automation-run-list is-compact">
          {job.runs.slice(0, 3).map((run) => <AutomationRunSummary key={run.id} run={run} />)}
          {job.runs.length === 0 && <div className="automation-runs-empty"><History /><strong>No runs yet</strong><span>The first terminal result will appear here.</span></div>}
        </div>
      </section>

      <footer className="automation-metadata"><span>Job ID <code>{job.id}</code><button type="button" aria-label="Copy job ID" onClick={onCopy}><Copy /></button></span><span>{job.systemOwned ? "Managed by OpenClaw" : "Team-owned automation"}</span></footer>
    </div>
  );
}

function AutomationRuns({ job, expandedRunId, onExpand }: { job: AutomationJob; expandedRunId?: string; onExpand: (run: AutomationRun) => void }) {
  return (
    <div className="automation-runs-panel">
      <header><div><span>Durable history</span><h2>Run history</h2><p>Inspect execution, output, delivery, and failure details for {job.name}.</p></div><button type="button"><ExternalLink />Open task history</button></header>
      <div className="automation-runs-summary">
        <div><strong>{job.runs.filter((run) => run.status === "ok").length}</strong><span>Succeeded</span></div>
        <div><strong>{job.runs.filter((run) => run.status === "error").length}</strong><span>Failed</span></div>
        <div><strong>{job.runs.filter((run) => run.status === "skipped").length}</strong><span>Skipped</span></div>
        <div><strong>{job.consecutiveErrors}</strong><span>Error streak</span></div>
      </div>
      <div className="automation-run-list">
        {job.runs.map((run) => (
          <article className={`automation-run is-${run.status}${expandedRunId === run.id ? " is-expanded" : ""}`} key={run.id}>
            <button type="button" onClick={() => onExpand(run)} aria-expanded={expandedRunId === run.id}>
              <span className="automation-run__status"><i>{run.status === "running" ? <LoaderCircle /> : run.status === "ok" ? <Check /> : run.status === "error" ? <X /> : <Pause />}</i><span><strong>{statusLabel(run.status)}</strong><small>{run.started}</small></span></span>
              <span><small>Duration</small><strong>{run.duration}</strong></span>
              <span><small>Delivery</small><strong>{run.deliveryStatus.replace("-", " ")}</strong></span>
              <ChevronDown />
            </button>
            {expandedRunId === run.id && <div className="automation-run__detail"><p>{run.summary}</p>{run.error && <div><TriangleAlert /><span><strong>Failure detail</strong><code>{run.error}</code></span></div>}<dl><div><dt>Run ID</dt><dd>{run.id}</dd></div><div><dt>Model</dt><dd>{run.model ?? "Not applicable"}</dd></div><div><dt>Usage</dt><dd>{run.usage ?? "Not reported"}</dd></div><div><dt>Completion</dt><dd>{run.status === "ok" ? "succeeded" : run.status === "error" ? "failed" : run.status}</dd></div></dl></div>}
          </article>
        ))}
        {job.runs.length === 0 && <div className="automation-runs-empty"><History /><strong>No runs yet</strong><span>Run this automation to create its first history record.</span></div>}
      </div>
    </div>
  );
}

function AutomationRunSummary({ run }: { run: AutomationRun }) {
  return <div className={`automation-run-summary is-${run.status}`}><i>{run.status === "running" ? <LoaderCircle /> : run.status === "ok" ? <Check /> : run.status === "error" ? <X /> : <Pause />}</i><span><strong>{statusLabel(run.status)}</strong><small>{run.started}</small></span><p>{run.summary}</p><span><strong>{run.duration}</strong><small>{run.deliveryStatus.replace("-", " ")}</small></span></div>;
}

function PayloadIcon({ kind }: { kind: AutomationPayloadKind }) {
  if (kind === "agentTurn") return <Bot />;
  if (kind === "command") return <TerminalSquare />;
  if (kind === "script") return <Code2 />;
  if (kind === "skillCollectionReview") return <Sparkles />;
  return <BellRing />;
}

function DeliveryIcon({ mode }: { mode: AutomationDeliveryMode }) {
  if (mode === "announce") return <MessageSquareText />;
  if (mode === "webhook") return <Webhook />;
  return <Pause />;
}

type ComposerProps = {
  draft: AutomationDraft;
  editing: boolean;
  onChange: (draft: AutomationDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
};

function AutomationComposer({ draft, editing, onChange, onClose, onSubmit }: ComposerProps) {
  const set = <Key extends keyof AutomationDraft>(key: Key, value: AutomationDraft[Key]) => onChange({ ...draft, [key]: value });
  const dangerous = draft.payloadKind === "command" || draft.payloadKind === "script" || draft.scheduleKind === "stream" || Boolean(draft.triggerScript);
  const valid = draft.name.trim() && draft.scheduleValue.trim() && draft.payload.trim();
  return (
    <div className="automation-composer-layer">
      <button type="button" className="automation-composer__scrim" aria-label="Close automation editor" onClick={onClose} />
      <aside className="automation-composer" aria-label={editing ? "Edit automation" : "Create automation"}>
        <header><div><span>{editing ? "Update job" : "New job"}</span><h2>{editing ? "Edit automation" : "Create automation"}</h2><p>Configure the OpenClaw scheduler in plain sight.</p></div><button type="button" aria-label="Close automation editor" onClick={onClose}><X /></button></header>
        <form onSubmit={onSubmit}>
          <section className="automation-form-section">
            <div className="automation-form-section__heading"><span>01</span><div><h3>Name the work</h3><p>Make it obvious to the next teammate what this job owns.</p></div></div>
            <label><span>Name</span><input value={draft.name} onChange={(event) => set("name", event.target.value)} placeholder="Morning team brief" /></label>
            <label><span>Description</span><textarea value={draft.description} onChange={(event) => set("description", event.target.value)} placeholder="What should the team expect from this automation?" rows={2} /></label>
          </section>

          <section className="automation-form-section">
            <div className="automation-form-section__heading"><span>02</span><div><h3>Choose a trigger</h3><p>All current OpenClaw schedule families are available.</p></div></div>
            <div className="automation-choice-grid is-five" aria-label="Schedule type">
              {(Object.entries(SCHEDULE_META) as [AutomationScheduleKind, (typeof SCHEDULE_META)[AutomationScheduleKind]][]).map(([kind, meta]) => { const Icon = meta.icon; return <button type="button" key={kind} className={draft.scheduleKind === kind ? "is-selected" : ""} aria-label={`${meta.label}: ${meta.description}`} aria-pressed={draft.scheduleKind === kind} onClick={() => set("scheduleKind", kind)}><Icon /><strong>{meta.label}</strong><small>{meta.description}</small></button>; })}
            </div>
            <ScheduleFields draft={draft} set={set} />
            {(draft.scheduleKind === "cron" || draft.scheduleKind === "every") && <details className="automation-advanced-inline"><summary>Condition and pacing <ChevronDown /></summary><label><span>Condition script <em>optional</em></span><textarea value={draft.triggerScript} onChange={(event) => set("triggerScript", event.target.value)} placeholder="Return { fire, message?, state? }" rows={3} /></label><div><label><span>Pacing minimum</span><input value={draft.pacingMin} onChange={(event) => set("pacingMin", event.target.value)} placeholder="15m" /></label><label><span>Pacing maximum</span><input value={draft.pacingMax} onChange={(event) => set("pacingMax", event.target.value)} placeholder="4h" /></label></div></details>}
          </section>

          <section className="automation-form-section">
            <div className="automation-form-section__heading"><span>03</span><div><h3>Define the action</h3><p>Each automation carries exactly one payload.</p></div></div>
            <div className="automation-choice-grid is-four" aria-label="Payload type">
              {(Object.entries(PAYLOAD_META) as [AutomationDraft["payloadKind"], (typeof PAYLOAD_META)[AutomationDraft["payloadKind"]]][]).map(([kind, meta]) => { const Icon = meta.icon; return <button type="button" key={kind} className={draft.payloadKind === kind ? "is-selected" : ""} aria-label={meta.label} aria-pressed={draft.payloadKind === kind} onClick={() => set("payloadKind", kind)}><Icon /><strong>{meta.label}</strong></button>; })}
            </div>
            <label><span>{draft.payloadKind === "agentTurn" ? "Agent instruction" : draft.payloadKind === "systemEvent" ? "Event text" : draft.payloadKind === "command" ? "Command or argv" : "Code-mode script"}</span><textarea value={draft.payload} onChange={(event) => set("payload", event.target.value)} placeholder={draft.payloadKind === "agentTurn" ? "Summarize workspace changes and post the useful decisions…" : draft.payloadKind === "command" ? "./scripts/check-queue.sh" : "Enter the automation payload…"} rows={5} className={draft.payloadKind === "command" || draft.payloadKind === "script" ? "is-code" : ""} /></label>
            {(draft.payloadKind === "command" || draft.payloadKind === "script") && <label><span>Working directory</span><input value={draft.workingDirectory} onChange={(event) => set("workingDirectory", event.target.value)} /></label>}
          </section>

          <section className="automation-form-section">
            <div className="automation-form-section__heading"><span>04</span><div><h3>Execution and delivery</h3><p>Choose context, ownership, and where the result lands.</p></div></div>
            <div className="automation-field-grid is-three">
              <label><span>Session</span><select value={draft.sessionTarget} onChange={(event) => set("sessionTarget", event.target.value as AutomationDraft["sessionTarget"])}><option value="isolated">Isolated</option><option value="main">Main session</option><option value="current">Current session</option><option value="session:release">Custom · release</option></select></label>
              <label><span>Agent</span><select value={draft.agent} onChange={(event) => set("agent", event.target.value)}><option value="main">main</option><option value="release">release</option><option value="build">build</option></select></label>
              <label><span>Wake mode</span><select value={draft.wakeMode} onChange={(event) => set("wakeMode", event.target.value as AutomationDraft["wakeMode"])}><option value="now">Wake now</option><option value="next-heartbeat">Next heartbeat</option></select></label>
            </div>
            <div className="automation-delivery-choice" aria-label="Delivery mode">
              {(["announce", "webhook", "none"] as const).map((mode) => <button type="button" key={mode} className={draft.deliveryMode === mode ? "is-selected" : ""} aria-pressed={draft.deliveryMode === mode} onClick={() => set("deliveryMode", mode)}><DeliveryIcon mode={mode} /><span><strong>{mode === "announce" ? "Announce" : mode === "webhook" ? "Webhook" : "No delivery"}</strong><small>{mode === "announce" ? "Fallback to a chat target" : mode === "webhook" ? "POST the finished event" : "Log completion only"}</small></span></button>)}
            </div>
            {draft.deliveryMode === "announce" && <div className="automation-field-grid"><label><span>Channel</span><select value={draft.channel} onChange={(event) => set("channel", event.target.value)}><option value="last">Last resolved channel</option><option value="slack">Slack</option><option value="teams">Microsoft Teams</option><option value="discord">Discord</option></select></label><label><span>Target</span><input value={draft.target} onChange={(event) => set("target", event.target.value)} placeholder="Current conversation" /></label></div>}
            {draft.deliveryMode === "webhook" && <label><span>Webhook URL</span><input type="url" value={draft.target} onChange={(event) => set("target", event.target.value)} placeholder="https://hooks.example.invalid/automation" /></label>}
          </section>

          <section className="automation-form-section">
            <details className="automation-advanced-inline"><summary><span><Settings2 />Advanced runtime</span><ChevronDown /></summary><div className="automation-field-grid"><label><span>Model</span><select value={draft.model} onChange={(event) => set("model", event.target.value)}><option>Workspace default</option><option>openai/gpt-5.6-luna</option><option>openai/gpt-5.6-sol</option></select></label><label><span>Thinking</span><select value={draft.thinking} onChange={(event) => set("thinking", event.target.value)}><option>off</option><option>low</option><option>medium</option><option>high</option></select></label><label><span>Allowed tools</span><input value={draft.tools} onChange={(event) => set("tools", event.target.value)} placeholder="read, exec" /></label><label><span>Timeout seconds</span><input inputMode="numeric" value={draft.timeoutSeconds} onChange={(event) => set("timeoutSeconds", event.target.value)} /></label><label><span>Failure alert after</span><input inputMode="numeric" value={draft.failureAlertAfter} onChange={(event) => set("failureAlertAfter", event.target.value)} /></label></div></details>
          </section>

          {dangerous && <div className="automation-code-warning"><ShieldAlert /><span><strong>Unattended execution surface</strong><small>Condition scripts, stream sources, command payloads, and scripts run without a person present. Integration must preserve OpenClaw’s operator permissions and tool-policy ceiling.</small></span></div>}

          <footer><span><i />New jobs are enabled after creation</span><div><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={!valid}>{editing ? "Save changes" : "Create automation"}</button></div></footer>
        </form>
      </aside>
    </div>
  );
}

function ScheduleFields({ draft, set }: { draft: AutomationDraft; set: <Key extends keyof AutomationDraft>(key: Key, value: AutomationDraft[Key]) => void }) {
  if (draft.scheduleKind === "cron") return <div className="automation-field-grid"><label><span>Cron expression</span><input value={draft.scheduleValue} onChange={(event) => set("scheduleValue", event.target.value)} /></label><label><span>Timezone</span><select value={draft.timezone} onChange={(event) => set("timezone", event.target.value)}><option>America/Chicago</option><option>America/New_York</option><option>America/Los_Angeles</option><option>UTC</option></select></label><label className="automation-check"><input type="checkbox" checked={draft.exact} onChange={(event) => set("exact", event.target.checked)} /><i /><span><strong>Exact timing</strong><small>Disable automatic staggering</small></span></label></div>;
  if (draft.scheduleKind === "every") return <label><span>Interval</span><input value={draft.scheduleValue} onChange={(event) => set("scheduleValue", event.target.value)} placeholder="30m, 4h, or 1d" /></label>;
  if (draft.scheduleKind === "at") return <div className="automation-field-grid"><label><span>Date and time</span><input value={draft.scheduleValue} onChange={(event) => set("scheduleValue", event.target.value)} placeholder="2026-09-03T09:30:00" /></label><label><span>Timezone</span><select value={draft.timezone} onChange={(event) => set("timezone", event.target.value)}><option>America/Chicago</option><option>America/New_York</option><option>America/Los_Angeles</option><option>UTC</option></select></label></div>;
  if (draft.scheduleKind === "on-exit") return <div className="automation-field-grid"><label><span>Watched command</span><input value={draft.scheduleValue} onChange={(event) => set("scheduleValue", event.target.value)} placeholder="./scripts/watch.sh" /></label><label><span>Working directory</span><input value={draft.workingDirectory} onChange={(event) => set("workingDirectory", event.target.value)} /></label></div>;
  return <div className="automation-field-grid"><label><span>Stream command argv</span><input value={draft.scheduleValue} onChange={(event) => set("scheduleValue", event.target.value)} placeholder='["node","scripts/events.mjs"]' /></label><label><span>Match expression <em>optional</em></span><input value={draft.triggerScript} onChange={(event) => set("triggerScript", event.target.value)} placeholder="^(failed|recovered):" /></label></div>;
}
