import {
  ArrowLeft, Bot, Check, CircleAlert, Code2, File, FilePlus2, FlaskConical,
  FolderOpen, ImagePlus, LoaderCircle, PackageCheck, Play, Save, Settings2,
  Square, Trash2, Users, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import * as Y from "yjs";

import type { AutomationDraft } from "./AutomationsApp";
import {
  builderApi, ensureCollaborativeText, replaceCollaborativeText,
  type BuilderConnectionStatus, type BuilderDraft, type BuilderDraftConnection,
  type BuilderIssue, type BuilderPresence,
} from "./builderApi";
import { activitiesFromGatewayEvent, eventRecord, messagesFromSessionEvent, NeuraGateway } from "./openclaw";
import type { TeamDirectoryUser } from "./teamChat";
import type { SkillRecord } from "./SkillsApp";
import type { NeuraApproval } from "./types";
import "./builder-workspace.css";
import { BuilderForms, builderIssueField } from "./BuilderForms";

type CurrentUser = { id: string; displayName: string; role: "admin" | "user" };
type SharedTest = {
  id: string; initiatorId: string; initiatorName: string; status: "running" | "complete" | "stopped" | "error";
  prompt: string; createdAt: string; sessionKey?: string; runId?: string; output?: string; steps?: string[]; approval?: NeuraApproval;
};

type Props = {
  draft: BuilderDraft;
  connection: BuilderDraftConnection;
  currentUser: CurrentUser;
  directory: readonly TeamDirectoryUser[];
  skills: readonly SkillRecord[];
  gateway: NeuraGateway;
  onBack: () => void;
  onDraftChanged: (draft: BuilderDraft) => void;
  onPublished: () => void | Promise<void>;
  onPublishAutomation?: (draft: AutomationDraft, targetKey?: string) => Promise<{ jobId?: string; configRevision?: string } | void>;
  notify?: (message: string) => void;
};

const PRESENCE_COLORS = ["#7446e8", "#0e9a9a", "#de5f88", "#dd7b36", "#33956c", "#4f73d9"];

function slug(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/g, "");
}

function patchFrontmatter(source: string, values: { slug: string; description: string; scope: string }) {
  if (!source.startsWith("---\n") || source.indexOf("\n---\n", 4) < 0) return source;
  const end = source.indexOf("\n---\n", 4);
  let header = source.slice(4, end);
  const set = (key: string, value: string) => {
    const expression = new RegExp(`^${key}:.*$`, "m");
    header = expression.test(header) ? header.replace(expression, `${key}: ${value}`) : `${key}: ${value}\n${header}`;
  };
  set("name", values.slug || "new-skill");
  set("description", JSON.stringify(values.description || "Explain what this skill does and when to use it."));
  set("disable-model-invocation", values.scope === "team" ? "false" : "true");
  header = /^\s{4}scope:.*$/m.test(header)
    ? header.replace(/^\s{4}scope:.*$/m, `    scope: ${values.scope === "team" ? "team" : "personal"}`)
    : `${header}\nmetadata:\n  neural-labs:\n    scope: ${values.scope === "team" ? "team" : "personal"}`;
  return `---\n${header}\n---\n${source.slice(end + 5)}`;
}

function patchOpenAi(source: string, values: Record<string, string>, allowImplicit: boolean) {
  const replace = (input: string, key: string, value: string, indent = "  ") => {
    const expression = new RegExp(`^${indent}${key}:.*$`, "m");
    if (expression.test(input)) return value ? input.replace(expression, `${indent}${key}: ${JSON.stringify(value)}`) : input.replace(expression, "");
    return value ? input.replace(/^policy:/m, `${indent}${key}: ${JSON.stringify(value)}\npolicy:`) : input;
  };
  let next = source;
  next = replace(next, "display_name", values.displayName);
  next = replace(next, "short_description", values.shortDescription);
  next = replace(next, "default_prompt", values.defaultPrompt);
  next = replace(next, "brand_color", values.brandColor);
  next = replace(next, "icon_small", values.iconSmall);
  next = replace(next, "icon_large", values.iconLarge);
  const invocation = `  allow_implicit_invocation: ${allowImplicit ? "true" : "false"}`;
  next = /^\s{2}allow_implicit_invocation:.*$/m.test(next)
    ? next.replace(/^\s{2}allow_implicit_invocation:.*$/m, invocation)
    : /^policy:/m.test(next) ? next.replace(/^policy:/m, `policy:\n${invocation}`) : `${next.trimEnd()}\npolicy:\n${invocation}\n`;
  return next;
}

function patchDependencies(source: string, value: string) {
  const without = source.replace(/^dependencies:\n(?:^[ \t]+.*\n?)*/m, "");
  if (!value.trim()) return without;
  const tools = value.trim().split("\n").map((line) => `    ${line}`).join("\n");
  return `${without.trimEnd()}\ndependencies:\n  tools:\n${tools}\n`;
}

function bodyFromSkill(source: string) {
  if (!source.startsWith("---\n")) return source;
  const end = source.indexOf("\n---\n", 4);
  return end < 0 ? source : source.slice(end + 5);
}

function testArray(doc: Y.Doc) { return doc.getArray<SharedTest>("tests"); }

function replaceTest(array: Y.Array<SharedTest>, id: string, patch: Partial<SharedTest>) {
  const rows = array.toArray();
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return;
  array.doc?.transact(() => { array.delete(index, 1); array.insert(index, [{ ...rows[index], ...patch }]); });
}

function approvalFromTestEvent(event: { event: string; payload: unknown }): NeuraApproval | undefined {
  if (event.event !== "session.approval") return;
  const payload = eventRecord(event);
  if (!payload || payload.phase === "terminal") return;
  const raw = payload.approval && typeof payload.approval === "object" ? payload.approval as Record<string, unknown> : payload;
  const presentation = raw.presentation && typeof raw.presentation === "object" ? raw.presentation as Record<string, unknown> : {};
  const string = (record: Record<string, unknown>, key: string) => typeof record[key] === "string" ? record[key] as string : undefined;
  const id = string(raw, "id") ?? string(payload, "id");
  const kind = string(presentation, "kind") ?? string(raw, "kind");
  if (!id || !kind || !["exec", "plugin", "system-agent"].includes(kind)) return;
  const decisions = Array.isArray(presentation.allowedDecisions)
    ? presentation.allowedDecisions.filter((value): value is NeuraApproval["decisions"][number] => ["allow-once", "allow-always", "deny"].includes(String(value)))
    : ["allow-once", "deny"] as NeuraApproval["decisions"];
  return { id, sessionKey: string(raw, "sourceSessionKey") ?? string(payload, "sessionKey"), kind: kind as NeuraApproval["kind"], title: string(presentation, "title") ?? "Approval required", detail: string(presentation, "commandText") ?? string(presentation, "description") ?? "Neura needs approval to continue.", decisions };
}

export function BuilderWorkspace({ draft, connection, currentUser, directory, skills, gateway, onBack, onDraftChanged, onPublished, onPublishAutomation, notify }: Props) {
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<BuilderConnectionStatus>("connecting");
  const [tab, setTab] = useState<"form" | "source" | "preview" | "test">("form");
  const [selectedFile, setSelectedFile] = useState("SKILL.md");
  const [issues, setIssues] = useState<BuilderIssue[]>([]);
  const [busy, setBusy] = useState<string>();
  const [testPrompt, setTestPrompt] = useState("");
  const [collaboratorsOpen, setCollaboratorsOpen] = useState(false);
  const [selectedCollaborators, setSelectedCollaborators] = useState<string[]>(draft.collaboratorUserIds);
  const canvasRef = useRef<HTMLElement>(null);
  const [issueTarget, setIssueTarget] = useState<string>();
  const activeTests = useRef(new Map<string, { sessionKey: string; runId?: string; subscription?: Awaited<ReturnType<NeuraGateway["subscribeSession"]>> }>());

  useEffect(() => connection.onChange(() => setVersion((value) => value + 1)), [connection]);
  useEffect(() => connection.onStatus(setStatus), [connection]);
  useEffect(() => {
    const remove = gateway.onEvent((event) => {
      if (event.event === "session.approval") {
        const approval = approvalFromTestEvent(event);
        const payload = eventRecord(event);
        const sessionKey = approval?.sessionKey ?? (typeof payload?.sessionKey === "string" ? payload.sessionKey : undefined);
        for (const [id, active] of activeTests.current) if (sessionKey === active.sessionKey) replaceTest(testArray(connection.doc), id, { approval });
      }
      const message = messagesFromSessionEvent(event);
      if (message) {
        for (const [id, active] of activeTests.current) {
          if (message.sessionKey !== active.sessionKey) continue;
          const assistant = [...message.messages].reverse().find((item) => item.role === "assistant" && item.text.trim());
          const final = message.phase === "end" || message.phase === "error" || message.phase === "final" || message.phase === "complete";
          if (assistant || final) replaceTest(testArray(connection.doc), id, { ...(assistant ? { output: assistant.text } : {}), ...(final ? { status: message.phase === "error" ? "error" : "complete" } : {}) });
          if (final) { if (active.subscription) void gateway.unsubscribeSession(active.subscription); activeTests.current.delete(id); }
        }
      }
      const activities = activitiesFromGatewayEvent(event);
      for (const activity of activities) {
        for (const [id, active] of activeTests.current) {
          if (activity.sessionKey !== active.sessionKey) continue;
          const row = testArray(connection.doc).toArray().find((item) => item.id === id);
          const line = [activity.title, activity.detail].filter(Boolean).join(" — ");
          if (line) replaceTest(testArray(connection.doc), id, { steps: [...(row?.steps ?? []).filter((item) => item !== line), line].slice(-24) });
        }
      }
      if (event.event === "chat") {
        const payload = eventRecord(event);
        const sessionKey = typeof payload?.sessionKey === "string" ? payload.sessionKey : undefined;
        const state = typeof payload?.state === "string" ? payload.state : undefined;
        for (const [id, active] of activeTests.current) {
          if (sessionKey && sessionKey !== active.sessionKey || payload?.runId && payload.runId !== active.runId) continue;
          if (state === "delta" && typeof payload?.deltaText === "string") {
            const row = testArray(connection.doc).toArray().find((item) => item.id === id);
            replaceTest(testArray(connection.doc), id, { output: payload.replace === true ? payload.deltaText : `${row?.output ?? ""}${payload.deltaText}` });
          }
          if (["final", "aborted", "error"].includes(state ?? "")) {
            replaceTest(testArray(connection.doc), id, { status: state === "final" ? "complete" : state === "aborted" ? "stopped" : "error" });
            if (active.subscription) void gateway.unsubscribeSession(active.subscription);
            activeTests.current.delete(id);
          }
        }
      }
    });
    return () => {
      remove();
      for (const active of activeTests.current.values()) if (active.subscription) void gateway.unsubscribeSession(active.subscription);
      activeTests.current.clear();
    };
  }, [connection, gateway]);

  const fields = connection.doc.getMap<Y.Text>("fields");
  const flags = connection.doc.getMap<boolean>("flags");
  const files = connection.doc.getMap<Y.Text>("files");
  const assets = connection.doc.getMap<{ hash: string; size: number; mimeType: string } | number>("assets");
  const value = (key: string) => fields.get(key)?.toString() ?? "";
  const setValue = (key: string, next: string) => replaceCollaborativeText(ensureCollaborativeText(fields, key), next);
  const fileNames = useMemo(() => [...files.keys()].sort((left, right) => left === "SKILL.md" ? -1 : right === "SKILL.md" ? 1 : left.localeCompare(right)), [files, version]);
  const tests = testArray(connection.doc).toArray().slice().reverse();
  const source = files.get("SKILL.md")?.toString() ?? "";
  const publishedSlug = draft.publishedKey || draft.targetKey;
  const presence = [...connection.awareness.getStates().values()].flatMap((state) => state?.user ? [state.user as BuilderPresence] : []);
  const sourceCursors = presence.filter((person) => person.userId !== currentUser.id && person.file === selectedFile && person.selection);
  const cursorLine = (person: BuilderPresence) => 1 + (files.get(selectedFile)?.toString().slice(0, person.selection?.head ?? 0).match(/\n/g)?.length ?? 0);

  useEffect(() => {
    if (!issueTarget) return;
    const field = Array.from(canvasRef.current?.querySelectorAll<HTMLElement>("[data-builder-field]") ?? []).find(element => element.dataset.builderField === issueTarget);
    if (field) {
      let parent = field.parentElement;
      while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
      field.focus();
      field.scrollIntoView?.({ block: "center", behavior: "instant" });
    } else canvasRef.current?.querySelector<HTMLTextAreaElement>(".builder-source textarea")?.focus();
    setIssueTarget(undefined);
  }, [tab, issueTarget]);

  const inspectIssue = (issue: BuilderIssue) => {
    const field = builderIssueField(issue, value("payloadKind"));
    if (field || draft.kind === "automation") { setTab("form"); setIssueTarget(field || "name"); }
    else { setSelectedFile(issue.file && files.has(issue.file) ? issue.file : "SKILL.md"); setTab("source"); setIssueTarget("source"); }
  };

  const updateInstructions = (next: string) => {
    const file = ensureCollaborativeText(files, "SKILL.md");
    const current = file.toString();
    const end = current.startsWith("---\n") ? current.indexOf("\n---\n", 4) : -1;
    replaceCollaborativeText(file, end < 0 ? next : current.slice(0, end + 5) + next);
  };

  const setSkillValue = (key: string, next: string) => {
    if (key === "slug") next = slug(next);
    setValue(key, next);
    const values = { name: key === "name" ? next : value("name"), description: key === "description" ? next : value("description"), scope: key === "scope" ? next : value("scope") };
    const nextSlug = publishedSlug || (key === "slug" ? next : key === "name" ? slug(values.name) : value("slug") || slug(values.name));
    if (!publishedSlug) setValue("slug", nextSlug);
    const skillFile = ensureCollaborativeText(files, "SKILL.md");
    replaceCollaborativeText(skillFile, patchFrontmatter(skillFile.toString(), { slug: nextSlug, description: values.description, scope: values.scope }));
    const openai = ensureCollaborativeText(files, "agents/openai.yaml");
    if (key === "name" && !value("displayName")) setValue("displayName", next);
    if (key === "description" && !value("shortDescription")) setValue("shortDescription", next.slice(0, 64));
    const metadata = Object.fromEntries(["displayName", "shortDescription", "defaultPrompt", "brandColor", "iconSmall", "iconLarge"].map((name) => [name, key === name ? next : name === "displayName" && key === "name" && !value(name) ? next : name === "shortDescription" && key === "description" && !value(name) ? next.slice(0, 64) : value(name)]));
    if (!publishedSlug && (key === "name" || key === "slug")) { metadata.defaultPrompt = `Use $${nextSlug || "new-skill"} to complete this task.`; setValue("defaultPrompt", metadata.defaultPrompt); }
    replaceCollaborativeText(openai, patchOpenAi(openai.toString(), metadata, flags.get("allowImplicitInvocation") === true));
  };

  const createTextFile = (directoryName: "references" | "scripts") => {
    const requested = window.prompt(`Name the ${directoryName === "scripts" ? "script" : "reference"} file:`)?.trim().replaceAll("\\", "/");
    if (!requested) return;
    const name = requested.replace(/^\/+/, "").replace(/\.\./g, "");
    const path = `${directoryName}/${name}`;
    if (files.has(path)) return notify?.(`${path} already exists.`);
    files.set(path, new Y.Text(directoryName === "scripts" ? "#!/usr/bin/env bash\nset -euo pipefail\n\n" : `# ${name}\n\n`));
    setSelectedFile(path); setTab("source");
  };

  const uploadAsset = async (file: File | undefined) => {
    if (!file) return;
    setBusy("asset");
    try { await builderApi.saveAsset(draft.id, `assets/${file.name.replace(/[^A-Za-z0-9._-]/g, "-")}`, file); notify?.(`${file.name} added to the draft.`); }
    catch (reason) { notify?.(reason instanceof Error ? reason.message : "The asset could not be uploaded."); }
    finally { setBusy(undefined); }
  };

  const validate = async () => {
    setBusy("validate");
    try { const result = await builderApi.validate(draft.id); setIssues(result.issues); if (!result.issues.length) notify?.("Draft validation passed."); else inspectIssue(result.issues[0]); }
    catch (reason) { notify?.(reason instanceof Error ? reason.message : "Validation failed."); }
    finally { setBusy(undefined); }
  };

  const publish = async () => {
    if (!draft.canPublish || busy) return;
    setBusy("publish");
    try {
      const validation = await builderApi.validate(draft.id);
      setIssues(validation.issues);
      const firstError = validation.issues.find(issue => issue.level === "error");
      if (firstError) { inspectIssue(firstError); return; }
      const result = await builderApi.publish(draft.id);
      if (result.kind === "automation") {
        if (!onPublishAutomation) throw new Error("Only an administrator can publish automations.");
        const operational = await onPublishAutomation(result.draft as AutomationDraft, result.targetKey);
        const updated = await builderApi.finalizeAutomation(draft.id, operational?.jobId, operational?.configRevision);
        onDraftChanged(updated.draft);
      } else if (result.draft && "id" in result.draft) onDraftChanged(result.draft as BuilderDraft);
      await onPublished();
      notify?.(`${value("name") || draft.title} published.`);
    } catch (reason) { notify?.(reason instanceof Error ? reason.message : "Publish failed."); }
    finally { setBusy(undefined); }
  };

  const runTest = async () => {
    if (busy === "test") return;
    setBusy("test");
    const id = crypto.randomUUID();
    try {
      const snapshot = await builderApi.testSnapshot(draft.id, testPrompt.trim());
      const session = await gateway.createSession();
      const subscription = await gateway.subscribeSession(session.key);
      activeTests.current.set(id, { sessionKey: session.key, subscription });
      const row: SharedTest = { id, initiatorId: currentUser.id, initiatorName: currentUser.displayName, status: "running", prompt: testPrompt.trim() || "Try the draft skill", createdAt: snapshot.test.createdAt, sessionKey: session.key, steps: [] };
      testArray(connection.doc).insert(0, [row]);
      const sent = await gateway.send(session, snapshot.test.harness, [], "steer");
      activeTests.current.set(id, { sessionKey: session.key, runId: sent.runId, subscription });
      replaceTest(testArray(connection.doc), id, { runId: sent.runId });
      setTestPrompt("");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "The test could not start.";
      const array = testArray(connection.doc);
      if (array.toArray().some((row) => row.id === id)) replaceTest(array, id, { status: "error", output: message });
      const active = activeTests.current.get(id);
      if (active?.subscription) await gateway.unsubscribeSession(active.subscription).catch(() => undefined);
      activeTests.current.delete(id);
      notify?.(message);
    } finally { setBusy(undefined); }
  };

  const stopTest = async (test: SharedTest) => {
    if (test.initiatorId !== currentUser.id || !test.sessionKey) return;
    await gateway.abort(test.sessionKey, test.runId).catch(() => undefined);
    const active = activeTests.current.get(test.id);
    if (active?.subscription) await gateway.unsubscribeSession(active.subscription).catch(() => undefined);
    activeTests.current.delete(test.id);
    replaceTest(testArray(connection.doc), test.id, { status: "stopped" });
  };

  const resolveTestApproval = async (test: SharedTest, decision: NeuraApproval["decisions"][number]) => {
    if (!test.approval || test.initiatorId !== currentUser.id) return;
    await gateway.resolveApproval(test.approval.id, test.approval.kind, decision);
    replaceTest(testArray(connection.doc), test.id, { approval: undefined });
  };

  const saveCollaborators = async () => {
    setBusy("collaborators");
    try { const result = await builderApi.collaborators(draft.id, selectedCollaborators); onDraftChanged(result.draft); setCollaboratorsOpen(false); }
    catch (reason) { notify?.(reason instanceof Error ? reason.message : "Collaborators could not be updated."); }
    finally { setBusy(undefined); }
  };

  return <section className={`builder-workspace is-${draft.kind} view-${tab}`} aria-label={`${draft.kind === "skill" ? "Skill" : "Automation"} builder`}>
    <header className="builder-toolbar">
      <button type="button" className="builder-back" onClick={onBack}><ArrowLeft /> Library</button>
      <div className={`builder-kind is-${draft.kind}`}>{draft.kind === "skill" ? <Bot /> : <Settings2 />}<span><small>{draft.kind} draft</small><strong>{value("name") || draft.title}</strong></span></div>
      <div className={`builder-save-state is-${status}`}>{status === "connecting" ? <LoaderCircle /> : status === "connected" ? <Check /> : <CircleAlert />}<span>{status === "connected" ? "Connected · autosave on" : status === "disconnected" ? "Offline · reconnect to sync" : status}</span></div>
      <div className="builder-presence" aria-label={`${presence.length} collaborators present`}>{presence.slice(0, 4).map((person, index) => <span key={`${person.userId}-${index}`} style={{ "--presence-color": person.color || PRESENCE_COLORS[index % PRESENCE_COLORS.length] } as React.CSSProperties} title={person.displayName}>{person.displayName.slice(0, 1).toUpperCase()}</span>)}</div>
      {draft.canManageCollaborators && <button type="button" onClick={() => setCollaboratorsOpen(true)}><Users /> Collaborate</button>}
      <button type="button" onClick={() => void validate()} disabled={Boolean(busy)}><PackageCheck /> Validate</button>
      <button type="button" className="is-primary" onClick={() => void publish()} disabled={!draft.canPublish || Boolean(busy)}>{busy === "publish" ? <LoaderCircle /> : <Save />} {draft.targetKey || draft.publishedKey ? "Publish changes" : "Publish"}</button>
    </header>

    <nav className="builder-tabs" aria-label="Builder views">
      {(["form", ...(draft.kind === "skill" ? ["source" as const] : []), "preview", "test"] as const).map((item) => <button type="button" key={item} aria-current={tab === item ? "page" : undefined} onClick={() => setTab(item)}>{item === "form" ? <Settings2 /> : item === "source" ? <Code2 /> : item === "preview" ? <PackageCheck /> : <FlaskConical />}{item === "form" ? "Edit" : item}</button>)}
    </nav>

    <div className="builder-body">
      {draft.kind === "skill" && tab === "source" && <aside className="builder-package"><header><FolderOpen /><span><strong>Skill package</strong><small>{fileNames.length} editable files</small></span></header><div className="builder-package-list">{fileNames.map((name) => <button type="button" key={name} aria-current={selectedFile === name ? "page" : undefined} onClick={() => { setSelectedFile(name); setTab("source"); }}><File />{name}</button>)}{[...assets.entries()].filter(([name]) => name !== "version").map(([name, descriptor]) => <div key={name}><ImagePlus /><span>{name}<small>{typeof descriptor === "object" ? `${Math.ceil(descriptor.size / 1024)} KB` : "asset"}</small></span><button type="button" aria-label={`Remove ${name}`} onClick={() => void builderApi.removeAsset(draft.id, name)}><X /></button></div>)}</div><footer><button type="button" onClick={() => createTextFile("references")}><FilePlus2 /> Reference</button><button type="button" onClick={() => createTextFile("scripts")}><FilePlus2 /> Script</button><label><ImagePlus /> Asset<input type="file" onChange={(event) => void uploadAsset(event.target.files?.[0])} /></label></footer></aside>}

      <main ref={canvasRef} className="builder-canvas">
        {issues.length > 0 && <div className="builder-issues builder-validation" role="status" aria-label="Draft validation issues"><strong>Review before publishing</strong>{issues.map((issue, index) => <button type="button" key={`${issue.code}-${index}`} onClick={() => inspectIssue(issue)}><CircleAlert /><span><strong>{issue.level === "error" ? "Fix" : "Review"}{issue.file ? ` · ${issue.file}` : ""}</strong><small>{issue.message}</small></span></button>)}</div>}
        {tab === "form" && <BuilderForms draft={draft} skills={skills} value={value} setValue={setValue} setSkillValue={setSkillValue} instructions={bodyFromSkill(source)} onInstructions={updateInstructions} issues={issues}
          implicit={flags.get("allowImplicitInvocation") === true} onImplicit={next => { flags.set("allowImplicitInvocation", next); const openai = ensureCollaborativeText(files, "agents/openai.yaml"); replaceCollaborativeText(openai, patchOpenAi(openai.toString(), Object.fromEntries(["displayName", "shortDescription", "defaultPrompt", "brandColor", "iconSmall", "iconLarge"].map(name => [name, value(name)])), next)); }}
          exact={flags.get("exact") === true} onExact={next => flags.set("exact", next)}
          onDependencies={next => { setValue("dependencies", next); const openai = ensureCollaborativeText(files, "agents/openai.yaml"); replaceCollaborativeText(openai, patchDependencies(openai.toString(), next)); }} />}

        {tab === "source" && draft.kind === "skill" && <div className="builder-source"><header><div><span>Canonical source</span><strong>{selectedFile}</strong></div>{sourceCursors.length > 0 && <div className="builder-source-cursors" aria-label="Collaborator cursors">{sourceCursors.slice(0, 3).map((person) => <span key={person.userId} style={{ "--presence-color": person.color } as React.CSSProperties} title={`${person.displayName} is editing line ${cursorLine(person)}`}><i />{person.displayName} · L{cursorLine(person)}</span>)}</div>}<span className="builder-source-actions">{selectedFile !== "SKILL.md" && selectedFile !== "agents/openai.yaml" && <button type="button" onClick={() => { files.delete(selectedFile); setSelectedFile("SKILL.md"); }}><Trash2 /> Delete</button>}</span></header><textarea aria-label={`${selectedFile} source`} spellCheck={false} value={files.get(selectedFile)?.toString() ?? ""} onFocus={() => connection.updatePresence({ file: selectedFile })} onSelect={(event) => connection.updatePresence({ file: selectedFile, selection: { anchor: event.currentTarget.selectionStart, head: event.currentTarget.selectionEnd } })} onChange={(event) => replaceCollaborativeText(ensureCollaborativeText(files, selectedFile), event.target.value)} /></div>}
        {tab === "preview" && <div className="builder-preview"><header><span>Preview</span><h1>{value("name") || draft.title}</h1><p>{value("description")}</p></header>{draft.kind === "skill" ? <article><ReactMarkdown remarkPlugins={[remarkGfm]}>{bodyFromSkill(source)}</ReactMarkdown></article> : <dl className="builder-automation-preview"><div><dt>Trigger</dt><dd>{value("scheduleKind")} · {value("scheduleValue")}</dd></div><div><dt>Action</dt><dd>{value("payloadKind") === "skill" ? `$${value("skillKey")} ${value("skillPrompt")}` : value("payload")}</dd></div><div><dt>Session</dt><dd>{value("sessionTarget")}</dd></div><div><dt>Delivery</dt><dd>{value("deliveryMode")}</dd></div></dl>}</div>}
        {tab === "test" && <div className="builder-tests">
          <header><span>Unpublished snapshot</span><h1>Test in Neura</h1><p>Tests use an immutable copy of this draft and never add it to the live skill catalog.</p></header>
          <div className="builder-test-composer"><textarea rows={3} value={testPrompt} onChange={(event) => setTestPrompt(event.target.value)} placeholder="Describe a realistic task for this draft…" /><button type="button" onClick={() => void runTest()} disabled={busy === "test" || !testPrompt.trim()}>{busy === "test" ? <LoaderCircle /> : <Play />} Run test</button></div>
          <div className="builder-test-history">{tests.map((test) => <article key={test.id}><header><span className={`is-${test.status}`}><i />{test.status}</span><small>{test.initiatorName} · {new Date(test.createdAt).toLocaleString()}</small>{test.status === "running" && test.initiatorId === currentUser.id && <button type="button" onClick={() => void stopTest(test)}><Square /> Stop</button>}</header><strong>{test.prompt}</strong>{test.approval && <div className="builder-test-approval"><div><strong>{test.approval.title}</strong><code>{test.approval.detail}</code></div>{test.initiatorId === currentUser.id ? <span>{test.approval.decisions.map((decision) => <button type="button" key={decision} onClick={() => void resolveTestApproval(test, decision)}>{decision.replaceAll("-", " ")}</button>)}</span> : <small>Waiting for {test.initiatorName}</small>}</div>}{test.steps?.length ? <details><summary>{test.steps.length} agent steps</summary>{test.steps.map((step, index) => <p key={`${step}-${index}`}>{step}</p>)}</details> : null}{test.output && <div className="builder-test-output"><ReactMarkdown remarkPlugins={[remarkGfm]}>{test.output}</ReactMarkdown></div>}</article>)}{!tests.length && <div className="builder-empty"><FlaskConical /><h2>No shared tests yet</h2><p>Start with a small, representative prompt.</p></div>}</div>
        </div>}
      </main>
    </div>

    {collaboratorsOpen && <div className="builder-dialog-layer"><button type="button" className="builder-dialog-scrim" aria-label="Close collaborators" onClick={() => setCollaboratorsOpen(false)} /><section className="builder-dialog"><header><div><Users /><span><strong>Draft collaborators</strong><small>All administrators can inspect every draft.</small></span></div><button type="button" onClick={() => setCollaboratorsOpen(false)}><X /></button></header><div>{directory.filter((user) => user.id !== draft.ownerUserId).map((user) => <label key={user.id}><input type="checkbox" checked={selectedCollaborators.includes(user.id)} onChange={(event) => setSelectedCollaborators((current) => event.target.checked ? [...current, user.id] : current.filter((id) => id !== user.id))} /><span><strong>{user.displayName}</strong><small>@{user.handle} · {user.role}</small></span></label>)}</div><footer><button type="button" onClick={() => setCollaboratorsOpen(false)}>Cancel</button><button type="button" className="is-primary" disabled={busy === "collaborators"} onClick={() => void saveCollaborators()}><Check /> Save access</button></footer></section></div>}
  </section>;
}
