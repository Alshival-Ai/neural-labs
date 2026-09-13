// Isolated visual fixture: no sockets, tenant state, or scheduler writes.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { BuilderWorkspace } from "../src/BuilderWorkspace";
import { SkillsApp, PLACEHOLDER_SKILLS } from "../src/SkillsApp";
import { AutomationsApp, PLACEHOLDER_AUTOMATIONS } from "../src/AutomationsApp";
import { builderFixture } from "../src/test/builderFixture";
import "../src/styles.css";
const query = new URLSearchParams(location.search);
const fixture = builderFixture(query.get("kind") === "automation" ? "automation" : "skill");
if (query.has("edit")) fixture.draft.targetKey = fixture.draft.kind === "skill" ? "release-notes" : "morning-brief";
const noOp = () => undefined;
function Fixture() {
  const [kind, setKind] = useState<"skill" | "automation" | undefined>(query.has("kind") ? fixture.draft.kind : undefined);
  const [active, setActive] = useState(fixture);
  const open = (next: "skill" | "automation") => { active.connection.stop(); setActive(builderFixture(next)); setKind(next); };
  return <div style={{ container: "app-window / inline-size", height: "100%", width: "100%", ...(query.has("large") ? { "--desktop-font-body": "17px", "--desktop-font-small": "15px", "--desktop-font-caption": "14px" } : {}) }}>
    {kind ? <BuilderWorkspace {...active} skills={PLACEHOLDER_SKILLS} onBack={() => setKind(undefined)} onDraftChanged={noOp} onPublished={noOp} /> : <SkillsApp currentUserId="visual-fixture" skills={PLACEHOLDER_SKILLS.map(skill => skill.id === "customer-handoff" ? { ...skill, name: "Customer handoff and follow-up instructions for the entire support team" } : skill)} onCreateSkill={() => open("skill")} onCreateAutomation={() => open("automation")} onEditSkill={() => open("skill")} drafts={[{ id: "draft", title: "A long shared workflow draft ready for review", kind: "skill", ownerDisplayName: "Example", updatedAt: "2026-09-01T00:00:00Z" }]} onOpenDraft={() => open("skill")} automationsContent={<AutomationsApp embedded currentUserId="visual-fixture" jobs={PLACEHOLDER_AUTOMATIONS} onEditDraft={() => open("automation")} />} />}
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
