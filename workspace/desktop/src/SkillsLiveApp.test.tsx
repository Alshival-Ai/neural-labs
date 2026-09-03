import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SkillsLiveApp } from "./SkillsLiveApp";
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
    fireEvent.click(await screen.findByRole("button", { name: /Beta skill/ }));

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
