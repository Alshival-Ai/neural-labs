import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mergeCustomSkills, SkillsLiveApp } from "./SkillsLiveApp";
import { SkillsApp } from "./SkillsApp";
import type { NeuraGateway } from "./openclaw";
import type { ConnectionState } from "./types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function gatewayFixture() {
  let statusListener: ((state: ConnectionState, reason?: string) => void) | undefined;
  const gateway = {
    onStatus(listener: typeof statusListener) { statusListener = listener; return () => undefined; },
    onEvent() { return () => undefined; },
    start() { queueMicrotask(() => statusListener?.("connected")); },
    readSkillsStatus: async () => ({ skills: [
      { name: "Alpha skill", skillKey: "alpha-skill", source: "openclaw-bundled", filePath: "/app/skills/alpha-skill/SKILL.md", eligible: true },
      { name: "Beta skill", skillKey: "beta-skill", source: "openclaw-bundled", filePath: "/app/skills/beta-skill/SKILL.md", eligible: true },
    ] }),
    readSkillsCuratorStatus: async () => ({ skills: [] }),
    readAutomations: async () => ({ schedulerOnline: true, jobs: [] }),
  };
  return gateway as unknown as NeuraGateway;
}

describe("Skills live app", () => {
  it("lets an authorized admin edit the original Team skill without taking ownership", () => {
    const skills = mergeCustomSkills([], [{
      id: "team-workflow", key: "team-workflow", name: "Team workflow",
      description: "Shared workflow", scope: "team", ownerUserId: "maya",
      ownerDisplayName: "Maya", ownedByCurrentUser: false, editable: true,
      instructions: "Original instructions", path: "/workspace/skills/team-workflow/SKILL.md",
      createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z",
    }]);
    const onEdit = vi.fn();
    const onDuplicate = vi.fn();
    render(<SkillsApp skills={skills} initialSection="team" onEditSkill={onEdit} onDuplicateSkill={onDuplicate} onShare={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Team workflow" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ key: "team-workflow", scope: "team", ownedByCurrentUser: false }));
    expect(onDuplicate).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Make personal" })).not.toBeInTheDocument();
  });

  it("loads and renders the real SKILL.md when an installed skill is selected", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith("/workspace/api/skills") ? { skills: [] }
        : url.endsWith("/workspace/api/builder/drafts") ? { drafts: [] }
          : url.endsWith("/api/team/directory") ? { users: [] }
            : url.includes("/workspace/api/skills/instructions?") ? (() => {
              const skillKey = new URL(url, "https://neural-labs.example.com").searchParams.get("path")?.split("/").at(-2) ?? "unknown";
              return {
                path: `/app/skills/${skillKey}/SKILL.md`, sizeBytes: 96,
                content: `---\nname: ${skillKey}\ndescription: Live test instructions\n---\n\n# Full ${skillKey}\n\nThese are the live **system instructions**.`,
              };
            })()
            : {};
      return { ok: true, status: 200, json: async () => body } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const gateway = gatewayFixture();
    render(<SkillsLiveApp reader={gateway} canManage={false} currentUser={{ id: "maya", displayName: "Maya", role: "user" }} />);

    fireEvent.click(await screen.findByRole("button", { name: /^OpenClaw/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Beta skill/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("%2Fapp%2Fskills%2Fbeta-skill%2FSKILL.md"),
      expect.objectContaining({ signal: undefined }),
    ));
    const instructions = within(await screen.findByRole("region", { name: "Beta skill Markdown instructions" }));
    await waitFor(() => expect(instructions.getByRole("heading", { name: "Full beta-skill" })).toBeInTheDocument());
    expect(instructions.queryByText(/name: beta-skill/)).not.toBeInTheDocument();
  });

  it("shows an inline error instead of leaving SKILL.md in a permanent loading state", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/workspace/api/skills/instructions?")) return { ok: false, status: 403, json: async () => ({ error: { message: "That Skill is outside the readable workspace skill roots" } }) } as Response;
      const body = url.endsWith("/workspace/api/skills") ? { skills: [] }
        : url.endsWith("/workspace/api/builder/drafts") ? { drafts: [] }
          : url.endsWith("/api/team/directory") ? { users: [] } : {};
      return { ok: true, status: 200, json: async () => body } as Response;
    }));
    render(<SkillsLiveApp reader={gatewayFixture()} canManage={false} currentUser={{ id: "maya", displayName: "Maya", role: "user" }} />);

    fireEvent.click(await screen.findByRole("button", { name: /^OpenClaw/ }));
    const instructions = within(await screen.findByRole("region", { name: "Alpha skill Markdown instructions" }));
    expect(await instructions.findByText("That Skill is outside the readable workspace skill roots")).toBeInTheDocument();
    expect(instructions.queryByText(/Loading SKILL.md/)).not.toBeInTheDocument();
  });
});

it("lets members run an automation without an administrator gateway", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.endsWith("/workspace/api/skills") ? { skills: [] }
      : url.endsWith("/workspace/api/builder/drafts") ? { drafts: [] }
      : url.endsWith("/api/team/directory") ? { users: [] }
      : url.endsWith("/automations/snapshot") ? { status: { enabled: true }, jobs: [{ id: "example", name: "Member task", enabled: true, schedule: { kind: "every", everyMs: 60000 }, payload: { kind: "agentTurn" }, state: {} }], entries: [] }
      : url.endsWith("/automations/run") ? { accepted: true } : {};
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<SkillsLiveApp reader={gatewayFixture()} canManage={false} currentUser={{ id: "maya", displayName: "Maya", role: "user" }} initialSection="automations" />);
  const run = await screen.findByRole("button", { name: "Run now" });
  fireEvent.click(run);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/workspace/api/automations/run", expect.objectContaining({ method: "POST", body: expect.stringContaining('"jobId":"example"') })));
  expect(screen.queryByRole("button", { name: "Save automation" })).toBeNull();
});
