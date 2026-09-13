import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuilderWorkspace } from "./BuilderWorkspace";
import { builderApi, ensureCollaborativeText, replaceCollaborativeText } from "./builderApi";
import { builderFixture } from "./test/builderFixture";

const fixtures: ReturnType<typeof builderFixture>[] = [];
afterEach(() => { cleanup(); fixtures.splice(0).forEach(fixture => fixture.connection.stop()); vi.restoreAllMocks(); });
function setup(kind: "skill" | "automation" = "skill", canPublish = true) {
  const fixture = builderFixture(kind); fixtures.push(fixture);
  fixture.draft.canPublish = canPublish;
  const onPublished = vi.fn();
  const onPublishAutomation = vi.fn(async () => ({ jobId: "published-job" }));
  render(<BuilderWorkspace {...fixture} onBack={vi.fn()} onDraftChanged={vi.fn()} onPublished={onPublished} onPublishAutomation={onPublishAutomation} />);
  return { ...fixture, onPublished, onPublishAutomation };
}

describe("Sectioned builder", () => {
  it("edits instructions without changing frontmatter and reflects collaborative source edits", () => {
    const { connection } = setup();
    const file = ensureCollaborativeText(connection.doc.getMap("files"), "SKILL.md");
    const originalHeader = file.toString().split("\n---\n")[0];
    expect(screen.queryByText("Skill package")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Instructions for Neura"), { target: { value: "# New instructions\n\nKeep useful links." } });
    expect(file.toString()).toBe(`${originalHeader}\n---\n# New instructions\n\nKeep useful links.`);
    act(() => replaceCollaborativeText(file, `${originalHeader}\n---\n# Collaborator update`));
    expect(screen.getByLabelText("Instructions for Neura")).toHaveValue("# Collaborator update");
    fireEvent.click(screen.getByRole("button", { name: "source" }));
    expect(screen.getByText("Skill package")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: `${originalHeader}\n---\n# Source update` } });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Instructions for Neura")).toHaveValue("# Source update");
  });

  it("keeps a custom shortcut when other skill settings change", () => {
    const { connection } = setup();
    fireEvent.change(screen.getByLabelText("Shortcut"), { target: { value: "Custom Brief" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "A more detailed description of the release workflow." } });
    fireEvent.change(screen.getByLabelText("Who can use it"), { target: { value: "team" } });
    expect(screen.getByLabelText("Shortcut")).toHaveValue("custom-brief");
    expect(connection.doc.getMap("files").get("SKILL.md")?.toString()).toContain("name: custom-brief");
  });

  it("retains conditional automation values across action, schedule, delivery and view changes", () => {
    const { connection } = setup("automation");
    expect(screen.queryByRole("button", { name: "source" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Schedule type"), { target: { value: "every" } });
    expect(screen.queryByLabelText("Timezone")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Repeat interval"), { target: { value: "2h" } });
    fireEvent.change(screen.getByLabelText("Action", { exact: true }), { target: { value: "skill" } });
    expect(screen.queryByLabelText("Instructions for the agent")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Send results"), { target: { value: "webhook" } });
    fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value: "https://example.org/results" } });
    fireEvent.change(screen.getByLabelText("Send results"), { target: { value: "none" } });
    fireEvent.click(screen.getByRole("button", { name: "preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Action", { exact: true }), { target: { value: "agentTurn" } });
    expect(screen.getByLabelText("Instructions for the agent")).toHaveValue("Summarize completed work, blockers, and the next steps for the team.");
    const field = (key: string) => connection.doc.getMap("fields").get(key)?.toString();
    expect(field("timezone")).toBe("America/Chicago");
    expect(field("pacingMin")).toBe("15m");
    expect(field("target")).toBe("https://example.org/results");
    expect(screen.getByLabelText("Repeat interval")).toHaveValue("2h");
  });

  it("opens hidden validation fields, focuses them, and blocks invalid publishing", async () => {
    const { onPublished } = setup();
    vi.spyOn(builderApi, "validate").mockResolvedValue({ kind: "skill", revision: "r", issues: [{ level: "error", code: "invalid_short_description", message: "Use 25–64 characters", file: "agents/openai.yaml" }] });
    const publish = vi.spyOn(builderApi, "publish");
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(screen.getByLabelText("Short description")).toHaveFocus());
    expect(screen.getByLabelText("Short description").closest("details")).toHaveAttribute("open");
    expect(screen.getByLabelText("Short description")).toHaveAttribute("aria-invalid", "true");
    expect(publish).not.toHaveBeenCalled();
    expect(onPublished).not.toHaveBeenCalled();
  });

  it("preserves the automation publish and finalize sequence after successful validation", async () => {
    const { onPublishAutomation, onPublished, draft } = setup("automation");
    vi.spyOn(builderApi, "validate").mockResolvedValue({ kind: "automation", revision: "r", issues: [] });
    vi.spyOn(builderApi, "publish").mockResolvedValue({ kind: "automation", draft: { name: "Morning team brief" }, targetKey: "job-original" });
    const finalize = vi.spyOn(builderApi, "finalizeAutomation").mockResolvedValue({ draft });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(onPublished).toHaveBeenCalledOnce());
    expect(onPublishAutomation).toHaveBeenCalledWith({ name: "Morning team brief" }, "job-original");
    expect(finalize).toHaveBeenCalledWith("fixture", "published-job", undefined);
  });

  it("keeps publishing unavailable when the draft does not grant permission", () => {
    setup("automation", false);
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  });
});
