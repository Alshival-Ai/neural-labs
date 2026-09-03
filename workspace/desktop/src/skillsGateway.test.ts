import { describe, expect, it } from "vitest";

import {
  mapSkillProposals,
  mapSkillSearch,
  mapSkillsStatus,
  mergeProposalInspection,
  mergeSkillInstructions,
  mergeSkillDetail,
} from "./skillsGateway";

describe("OpenClaw Skills mapping", () => {
  it("maps effective status, eligibility, requirements, ownership, and usage", () => {
    const proposals = { proposals: [{ kind: "create", status: "applied", skillKey: "release-notes" }] };
    const skills = mapSkillsStatus({
      agentId: "main",
      skills: [{
        name: "Release notes",
        description: "Draft a release summary",
        source: "openclaw-workspace",
        skillKey: "release-notes",
        filePath: "/workspace/skills/release-notes/SKILL.md",
        eligible: false,
        userInvocable: true,
        modelVisible: false,
        requirements: { bins: ["git"], anyBins: [], env: ["RELEASE_TOKEN"], config: [], os: [] },
        missing: { bins: [], anyBins: [], env: ["RELEASE_TOKEN"], config: [], os: [] },
      }],
    }, { skills: [{ skillKey: "release-notes", useCount: 7, lastUsedAtMs: Date.now() - 60_000 }] }, proposals);

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      key: "release-notes",
      source: "workspace",
      eligibility: "needs-setup",
      writable: true,
      useCount: 7,
      command: "$release-notes",
    });
    expect(skills[0].requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "git", state: "met" }),
      expect.objectContaining({ value: "RELEASE_TOKEN", state: "missing" }),
    ]));
  });

  it("hydrates exact skill cards and Workshop proposal revisions", () => {
    const base = mapSkillsStatus({ skills: [{ name: "Deploy", skillKey: "deploy", source: "openclaw-bundled", eligible: true }] }, {}, {})[0];
    const card = mergeSkillInstructions(base, { path: "/app/skills/deploy/SKILL.md", sizeBytes: 2048, content: "# Deploy\n\nVerify first." });
    expect(card).toMatchObject({ path: "/app/skills/deploy/SKILL.md", instructions: "# Deploy\n\nVerify first." });
    expect(card.instructionsState).toBe("loaded");
    expect(card.files[0].size).toBe("2.0 KB");

    const proposal = mapSkillProposals({ proposals: [{
      id: "proposal-1", kind: "update", status: "pending", title: "Update deploy", description: "Safer deploys", skillKey: "deploy", updatedAt: new Date().toISOString(), scanState: "clean",
    }] })[0];
    const inspected = mergeProposalInspection(proposal, {
      revisionHash: "a".repeat(64),
      content: "---\nname: deploy\n---\n\nVerify rollback.",
      record: {
        title: "Update deploy", status: "pending", updatedAt: new Date().toISOString(), goal: "Add rollback", evidence: "Three incidents",
        draftHash: "b".repeat(64), target: { skillKey: "deploy", currentContentHash: "c".repeat(64) },
        scan: { critical: 0, warn: 0, findings: [] },
      },
      supportFiles: [{ path: "references/rollback.md", content: "Rollback" }],
    });
    expect(inspected).toMatchObject({ revisionHash: "a".repeat(64), draftHash: "bbbbbbbbbbbb", targetHash: "cccccccccccc", goal: "Add rollback" });
    expect(inspected.supportFiles).toEqual(["references/rollback.md"]);
  });

  it("maps registry search refs and enriches publisher details without inventing a scan", () => {
    const result = mapSkillSearch({ results: [{ score: 1, slug: "labs/review", installRef: "@labs/review", displayName: "Review", summary: "Review changes", version: "1.2.3" }] })[0];
    expect(result).toMatchObject({ installRef: "@labs/review", security: "warning", version: "1.2.3" });

    const enriched = mergeSkillDetail(result, {
      skill: { displayName: "Review", summary: "Review changes safely", updatedAt: Date.now(), tags: { review: "latest" } },
      owner: { handle: "labs", official: false },
      latestVersion: { version: "1.2.3", changelog: "Adds migration checks." },
      metadata: { os: ["linux"] },
    });
    expect(enriched).toMatchObject({ owner: "labs", official: false, security: "warning", changelog: "Adds migration checks.", requirements: "OS linux" });
  });
});
