import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SkillsApp } from "./SkillsApp";

afterEach(cleanup);

describe("Skills app prototype", () => {
  it("surfaces OpenClaw eligibility and source requirements", () => {
    render(<SkillsApp />);

    fireEvent.click(screen.getByRole("button", { name: /^attention/ }));
    const library = within(screen.getByRole("complementary", { name: "Skill library" }));
    expect(library.getByRole("button", { name: "Image lab" })).toBeInTheDocument();
    expect(library.getByRole("button", { name: "Mac window control" })).toBeInTheDocument();
    expect(library.queryByRole("button", { name: "Release notes" })).not.toBeInTheDocument();

    fireEvent.click(library.getByRole("button", { name: "Image lab" }));
    const detail = within(screen.getByRole("region", { name: "Image lab details" }));
    expect(detail.getAllByText("Needs setup")).toHaveLength(2);
    expect(detail.getByText("IMAGE_PROVIDER_API_KEY")).toBeInTheDocument();
  });

  it("exposes enable and explicit invocation integration seams", () => {
    const onToggle = vi.fn();
    const onInvoke = vi.fn();
    render(<SkillsApp onToggle={onToggle} onInvoke={onInvoke} />);

    fireEvent.click(screen.getByRole("button", { name: "Use in Neura" }));
    expect(onInvoke).toHaveBeenCalledWith(expect.objectContaining({ id: "release-notes" }));

    fireEvent.click(screen.getByRole("checkbox", { name: "Enable Release notes" }));
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: "release-notes" }), false);
  });

  it("keeps Workshop apply behind the proposal lifecycle", () => {
    const onProposalAction = vi.fn();
    render(<SkillsApp onProposalAction={onProposalAction} />);

    fireEvent.click(screen.getByRole("button", { name: /^Workshop/ }));
    fireEvent.click(screen.getByRole("button", { name: "Apply revision" }));
    expect(onProposalAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "proposal-release-quality", status: "pending" }),
      "apply",
    );
  });

  it("searches ClawHub and preserves install scope", () => {
    const onInstall = vi.fn();
    render(<SkillsApp onInstall={onInstall} />);

    fireEvent.click(screen.getByRole("button", { name: /^Discover/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search ClawHub" }), { target: { value: "data" } });
    fireEvent.click(screen.getByRole("button", { name: "Data cleanup" }));
    fireEvent.click(screen.getByRole("button", { name: /^Personal/ }));
    fireEvent.click(screen.getByRole("button", { name: "Install 1.1.0" }));

    expect(onInstall).toHaveBeenCalledWith(expect.objectContaining({ slug: "labs/data-cleanup" }), "personal");
  });

  it("does not submit an empty ClawHub search", async () => {
    const onDiscoverSearch = vi.fn();
    render(<SkillsApp onDiscoverSearch={onDiscoverSearch} />);

    fireEvent.click(screen.getByRole("button", { name: /^Discover/ }));
    await new Promise((resolve) => window.setTimeout(resolve, 400));

    expect(onDiscoverSearch).not.toHaveBeenCalled();
  });

  it("clears prior ClawHub results locally when the query is erased", async () => {
    const onDiscoverSearch = vi.fn();
    render(<SkillsApp onDiscoverSearch={onDiscoverSearch} />);

    fireEvent.click(screen.getByRole("button", { name: /^Discover/ }));
    const input = screen.getByRole("textbox", { name: "Search ClawHub" });
    fireEvent.change(input, { target: { value: "data" } });
    await waitFor(() => expect(onDiscoverSearch).toHaveBeenCalledWith("data"), { timeout: 700 });
    fireEvent.change(input, { target: { value: "" } });

    await waitFor(() => expect(onDiscoverSearch).toHaveBeenLastCalledWith(""));
  });

  it("creates a governed skill proposal without writing the live library", async () => {
    const onPropose = vi.fn();
    render(<SkillsApp onPropose={onPropose} />);

    fireEvent.click(screen.getByRole("button", { name: "New skill" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Support escalation" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Why this belongs" }), { target: { value: "The team repeats this escalation shape." } });
    fireEvent.click(screen.getByRole("button", { name: "Create proposal" }));

    expect(onPropose).toHaveBeenCalledWith(expect.objectContaining({
      name: "Support escalation",
      scope: "workspace",
      userInvocable: true,
      modelInvocable: true,
    }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Nothing live changed"));
  });
});
