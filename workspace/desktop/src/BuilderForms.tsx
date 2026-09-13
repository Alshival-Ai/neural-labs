import { Bot, CalendarClock, ChevronDown, FileText, Palette, Send, Settings2, Sparkles, Users, type LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";
import type { BuilderDraft, BuilderIssue } from "./builderApi";
import type { SkillRecord } from "./SkillsApp";

export function builderIssueField(issue: BuilderIssue, payloadKind: string): string | undefined {
  return ({ invalid_name: "slug", name_mismatch: "slug", invalid_description: "description", invalid_short_description: "shortDescription", invalid_default_prompt: "defaultPrompt", invalid_brand_color: "brandColor", missing_name: "name", missing_schedule: "scheduleValue", missing_action: payloadKind === "skill" ? "skillKey" : "payload" } as Record<string, string>)[issue.code];
}

type Props = {
  draft: BuilderDraft;
  skills: readonly SkillRecord[];
  value: (key: string) => string;
  setValue: (key: string, next: string) => void;
  setSkillValue: (key: string, next: string) => void;
  instructions: string;
  onInstructions: (next: string) => void;
  onDependencies: (next: string) => void;
  implicit: boolean;
  onImplicit: (next: boolean) => void;
  exact: boolean;
  onExact: (next: boolean) => void;
  issues: readonly BuilderIssue[];
};

function Section({ title, description, icon: Icon, accent, children, collapsible = false }: { title: string; description: string; icon: LucideIcon; accent: string; children: ReactNode; collapsible?: boolean }) {
  const heading = <><span className="builder-section-icon"><Icon /></span><span><strong>{title}</strong><small>{description}</small></span></>;
  return collapsible ? <details className={`builder-section is-${accent}`}><summary>{heading}<ChevronDown /></summary><div className="builder-field-grid">{children}</div></details>
    : <section className={`builder-section is-${accent}`}><header>{heading}</header><div className="builder-field-grid">{children}</div></section>;
}

function Field({ label, hint, error, children, wide = false }: { label: string; hint?: string; error?: string; children: (descriptionId: string | undefined) => ReactNode; wide?: boolean }) {
  const id = useId();
  return <label className={wide ? "is-wide" : undefined}><span>{label}</span>{children(hint || error ? id : undefined)}{(hint || error) && <small id={id} className={error ? "builder-field-error" : undefined}>{error || hint}</small>}</label>;
}

export function BuilderForms({ draft, skills, value, setValue, setSkillValue, instructions, onInstructions, onDependencies, implicit, onImplicit, exact, onExact, issues }: Props) {
  const skill = draft.kind === "skill";
  const set = skill ? setSkillValue : setValue;
  const publishedSlug = draft.publishedKey || draft.targetKey;
  const errorFor = (key: string) => issues.find(issue => builderIssueField(issue, value("payloadKind")) === key)?.message;
  const input = (key: string, label: string, hint?: string, options: { wide?: boolean; readOnly?: boolean; maxLength?: number; type?: string; placeholder?: string; content?: string } = {}) => <Field label={label} hint={hint} error={errorFor(key)} wide={options.wide}>{id => <input data-builder-field={key} aria-label={label} aria-describedby={id} aria-invalid={Boolean(errorFor(key))} value={options.content ?? value(key)} onChange={event => set(key, event.target.value)} readOnly={options.readOnly} maxLength={options.maxLength} type={options.type ?? "text"} placeholder={options.placeholder} />}</Field>;
  const text = (key: string, label: string, hint?: string, options: { rows?: number; maxLength?: number; code?: boolean; content?: string; onChange?: (next: string) => void } = {}) => <Field label={label} hint={hint} error={errorFor(key)} wide>{id => <textarea data-builder-field={key} aria-label={label} aria-describedby={id} aria-invalid={Boolean(errorFor(key))} rows={options.rows ?? 3} maxLength={options.maxLength} className={options.code ? "is-code" : undefined} value={options.content ?? value(key)} onChange={event => (options.onChange ?? (next => set(key, next)))(event.target.value)} />}</Field>;
  const select = (key: string, label: string, choices: readonly (readonly [string, string])[], hint?: string, disabled = false) => <Field label={label} hint={hint} error={errorFor(key)}>{id => <select data-builder-field={key} aria-label={label} aria-describedby={id} aria-invalid={Boolean(errorFor(key))} value={value(key)} disabled={disabled} onChange={event => set(key, event.target.value)}>{!choices.some(([keyValue]) => keyValue === value(key)) && <option value={value(key)}>{value(key) || "Choose…"}</option>}{choices.map(([keyValue, title]) => <option key={keyValue} value={keyValue}>{title}</option>)}</select>}</Field>;
  const checkbox = (label: string, hint: string, checked: boolean, onChange: (next: boolean) => void) => <label className="builder-checkbox is-wide"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><span><strong>{label}</strong><small>{hint}</small></span></label>;
  const schedule = value("scheduleKind");
  const action = value("payloadKind");
  const scheduleLabels: Record<string, [string, string]> = {
    cron: ["Cron expression", "Five fields: minute, hour, day, month, weekday. Example: 0 9 * * 1-5."],
    every: ["Repeat interval", "Use a duration such as 30m, 4h, or 1d."],
    at: ["Date and time", "Use an ISO date and time, for example 2026-10-01T09:00:00."],
    "on-exit": ["Watched command", "Run the action when this command exits."],
    stream: ["Stream command", 'Command arguments as JSON, for example ["node", "scripts/events.mjs"].'],
  };
  return <div className="builder-form">
    <header><span>{draft.targetKey || draft.publishedKey ? "Edit" : "Create"} {skill ? "skill" : "automation"}</span><h1>{skill ? "Teach Neura how you work." : "Put a workflow on your schedule."}</h1><p>{skill ? "Describe the task, write the instructions, and choose who can use it." : "Choose what runs, when it runs, and where the results go."}</p></header>
    <Section title="Basics" description="Give this workflow a recognizable name." icon={Sparkles} accent="cyan">
      {input("name", "Name", undefined, { maxLength: skill ? 80 : undefined, wide: !skill })}
      {skill && input("slug", "Shortcut", publishedSlug ? "Published shortcuts cannot be renamed." : "Use this with $ in Neura. Lowercase letters, numbers, and hyphens.", { content: publishedSlug || value("slug"), readOnly: Boolean(publishedSlug) })}
      {text("description", "Description", "Explain when this is useful.", { rows: 2, maxLength: skill ? 500 : undefined })}
    </Section>
    {skill ? <>
      <Section title="Instructions" description="Tell Neura what to do, in your own words." icon={FileText} accent="violet">
        {text("instructions", "Instructions for Neura", "Include the steps, expected output, and useful examples. Markdown is supported; keep credentials out of instructions.", { rows: 12, content: instructions, onChange: onInstructions })}
      </Section>
      <Section title="Availability" description="Choose who can use this skill and how it starts." icon={Users} accent="mint">
        {select("scope", "Who can use it", [["personal", "Just me · My Skills"], ["team", "Everyone · Team Skills"]], "New skills are personal by default.", Boolean(draft.targetKey && skills.some(item => item.key === draft.targetKey && !item.ownedByCurrentUser)))}
        {checkbox("Let Neura choose this skill", "Neura can select it automatically when its instructions are relevant.", implicit, onImplicit)}
      </Section>
      <Section title="Appearance" description="Customize how the skill appears in the picker." icon={Palette} accent="pink" collapsible>
        {input("displayName", "Display name")}{input("shortDescription", "Short description", "25–64 characters.", { maxLength: 64 })}
        {text("defaultPrompt", "Suggested prompt", "Include the skill's $shortcut.", { rows: 2 })}
        {input("brandColor", "Accent color", "A six-digit hex color, such as #7b4dff.")}
        {input("iconSmall", "Small icon path", "A file in this skill's package.", { placeholder: "assets/icon.svg" })}
        {input("iconLarge", "Large icon path", undefined, { placeholder: "assets/icon-large.png" })}
      </Section>
      <Section title="Advanced" description="Configure tool dependencies. Manage package files in Source." icon={Settings2} accent="amber" collapsible>
        {text("dependencies", "MCP dependencies (YAML)", undefined, { rows: 5, code: true, onChange: onDependencies })}
      </Section>
    </> : <>
      <Section title="What to run" description="Choose the task this automation carries out." icon={Bot} accent="violet">
        {select("payloadKind", "Action", [["skill", "Use a skill"], ["agentTurn", "Ask an agent"], ["systemEvent", "Send a system event"], ["command", "Run a command"], ["script", "Run a script"]])}
        {action === "skill" ? <>{select("skillKey", "Skill", [["", "Choose a skill"], ...skills.map(item => [item.key, `${item.name} · $${item.key}`] as const)])}{text("skillPrompt", "Task for this skill", "Additional instructions to include after the shortcut.", { rows: 5 })}</> : text("payload", action === "command" ? "Command" : action === "script" ? "Script" : action === "systemEvent" ? "Event message" : "Instructions for the agent", undefined, { rows: 7, code: action === "command" || action === "script" })}
        {input("agent", "Scheduled run agent", "Scheduled runs use this agent. Run now uses your connected ChatGPT account.")}
      </Section>
      <Section title="When to run" description="Set the trigger and timing." icon={CalendarClock} accent="amber">
        {select("scheduleKind", "Schedule type", [["cron", "Recurring schedule (cron)"], ["every", "Repeat at an interval"], ["at", "Once at a date and time"], ["on-exit", "When a command exits"], ["stream", "When a stream matches"]])}
        {input("scheduleValue", ...(scheduleLabels[schedule] ?? ["Schedule", "Enter the schedule definition."]))}
        {(schedule === "cron" || schedule === "at") && input("timezone", "Timezone", "Use an IANA timezone, such as America/Chicago or UTC.")}
        {schedule === "stream" && input("triggerScript", "Match expression", "Optional expression to match stream events.")}
        {(schedule === "stream" || schedule === "on-exit" || action === "command" || action === "script") && input("workingDirectory", "Working directory")}
      </Section>
      <Section title="Delivery" description="Choose where completed results are sent." icon={Send} accent="mint">
        {select("deliveryMode", "Send results", [["none", "Keep in run history"], ["announce", "Announce to a channel"], ["webhook", "Send to a webhook"]])}
        {value("deliveryMode") === "announce" && input("channel", "Channel")}
        {value("deliveryMode") !== "none" && input("target", value("deliveryMode") === "webhook" ? "Webhook URL" : "Delivery target")}
      </Section>
      <Section title="Advanced" description="Execution settings, timing controls, and failure handling." icon={Settings2} accent="pink" collapsible>
        {(schedule === "cron" || schedule === "every") && <>{text("triggerScript", "Run condition", "Optional condition script.", { code: true })}{input("pacingMin", "Minimum pacing", "For example, 15m.")}{input("pacingMax", "Maximum pacing", "For example, 4h.")}</>}
        {schedule === "cron" && checkbox("Exact schedule", "Disable automatic staggering.", exact, onExact)}
        {select("sessionTarget", "Session", [["isolated", "Isolated session"], ["main", "Main session"], ["current", "Current session"]])}
        {select("wakeMode", "Wake mode", [["now", "Immediately"], ["next-heartbeat", "Next heartbeat"]])}
        {input("model", "Model")}{select("thinking", "Thinking", [["off", "Off"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]])}
        {input("tools", "Allowed tools")}{input("timeoutSeconds", "Timeout (seconds)")}{input("failureAlertAfter", "Alert after failures")}
      </Section>
    </>}
    <p className="builder-publish-note">Draft changes save automatically while connected. {skill ? "Publish when the skill is ready to use." : "Publishing updates the shared scheduler and requires an administrator."}</p>
  </div>;
}
