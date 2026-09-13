import { BuilderDraftConnection, ensureCollaborativeText, type BuilderDraft } from "../builderApi";
import type { NeuraGateway } from "../openclaw";

export function builderFixture(kind: "skill" | "automation" = "skill") {
  const user = { id: "fixture", displayName: "Example", role: "admin" as const };
  const connection = new BuilderDraftConnection("fixture", { userId: user.id, displayName: user.displayName, color: "#7b4dff" });
  // Local fixtures never open a socket or publish to a scheduler.
  connection.onStatus = listener => { listener("connected"); return () => undefined; };
  const fields = connection.doc.getMap("fields");
  const defaults = kind === "skill" ? {
    name: "Release notes", slug: "release-notes", description: "Turn completed work into clear, useful release notes.", scope: "personal",
    displayName: "Release notes", shortDescription: "Clear release notes for your team", defaultPrompt: "Use $release-notes to summarize this release.", brandColor: "#7b4dff", iconSmall: "", iconLarge: "", dependencies: "",
  } : {
    name: "Morning team brief", description: "Summarize overnight work and highlight what needs attention.",
    scheduleKind: "cron", scheduleValue: "0 9 * * 1-5", timezone: "America/Chicago", triggerScript: "", pacingMin: "15m", pacingMax: "4h", payloadKind: "agentTurn", payload: "Summarize completed work, blockers, and the next steps for the team.", skillKey: "", skillPrompt: "", workingDirectory: "/home/node/workspace", sessionTarget: "isolated", wakeMode: "now", agent: "main", deliveryMode: "none", channel: "last", target: "", model: "Workspace default", thinking: "low", tools: "", timeoutSeconds: "600", failureAlertAfter: "3",
  };
  for (const [key, value] of Object.entries(defaults)) ensureCollaborativeText(fields, key, value);
  if (kind === "skill") {
    const files = connection.doc.getMap("files");
    ensureCollaborativeText(files, "SKILL.md", '---\nname: release-notes\ndescription: Release notes for the team\nmetadata:\n  neural-labs:\n    scope: personal\n---\n# Release notes\n\nGroup completed work by customer outcome.\n\n- Lead with the changes that matter.\n- Include useful links and next steps.\n');
    ensureCollaborativeText(files, "agents/openai.yaml", 'interface:\n  display_name: "Release notes"\n  short_description: "Clear release notes for your team"\n  default_prompt: "Use $release-notes to summarize this release."\npolicy:\n  allow_implicit_invocation: false\n');
  }
  const draft: BuilderDraft = { id: "fixture", kind, title: defaults.name, ownerUserId: user.id, ownerDisplayName: user.displayName, collaboratorUserIds: [], createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", canPublish: true, canManageCollaborators: true, administrator: true };
  const gateway = { onEvent: () => () => undefined } as unknown as NeuraGateway;
  return { connection, draft, currentUser: user, directory: [], skills: [], gateway };
}
