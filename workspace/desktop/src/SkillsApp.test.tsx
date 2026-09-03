import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SkillsApp } from "./SkillsApp";

afterEach(cleanup);

describe("Skills app", () => {
  it("organizes skills into personal, team, and OpenClaw libraries", () => {
    render(<SkillsApp />);

    expect(screen.getByRole("complementary", { name: "My skill library" })).toHaveTextContent("Customer handoff");
    fireEvent.click(screen.getByRole("button", { name: /^Team Skills/ }));
    const team = within(screen.getByRole("complementary", { name: "Team skill library" }));
    expect(team.getByRole("button", { name: "Release notes" })).toBeInTheDocument();
    expect(team.queryByRole("button", { name: "Customer handoff" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^OpenClaw/ }));
    expect(screen.getByText("Installed OpenClaw skills")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /GitHub/ })).toBeInTheDocument();
  });

  it("saves a personal skill immediately without a proposal step", async () => {
    const onSave = vi.fn();
    render(<SkillsApp onSave={onSave} currentUserName="Maya" />);

    fireEvent.click(screen.getByRole("button", { name: "New skill" }));
    expect(screen.getByText("Saves immediately. No approval queue.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Support escalation" } });
    fireEvent.change(screen.getByRole("textbox", { name: "What it helps with" }), { target: { value: "Prepare a support escalation." } });
    fireEvent.click(screen.getByRole("button", { name: "Save skill" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Support escalation", scope: "personal" }), undefined);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("ready in your Neura skill picker"));
  });

  it("shares a personal skill directly with the team", async () => {
    const onShare = vi.fn();
    render(<SkillsApp onShare={onShare} />);

    fireEvent.click(screen.getByRole("button", { name: "Share with team" }));
    expect(onShare).toHaveBeenCalledWith(expect.objectContaining({ key: "customer-handoff" }), "team");
  });

  it("searches OpenClaw and keeps third-party installation admin-only", async () => {
    const onDiscoverSearch = vi.fn();
    render(<SkillsApp onDiscoverSearch={onDiscoverSearch} canInstallFromOpenClaw={false} />);

    fireEvent.click(screen.getByRole("button", { name: /^OpenClaw/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search OpenClaw skills" }), { target: { value: "data" } });
    await waitFor(() => expect(onDiscoverSearch).toHaveBeenCalledWith("data"), { timeout: 700 });
    fireEvent.click(screen.getByRole("button", { name: "Data cleanup" }));
    expect(screen.getByRole("button", { name: "Admin install" })).toBeDisabled();
  });

  it("surfaces setup requirements without exposing enablement controls", () => {
    render(<SkillsApp />);
    fireEvent.click(screen.getByRole("button", { name: /^Team Skills/ }));
    fireEvent.click(screen.getByRole("button", { name: "Image lab" }));

    const detail = within(screen.getByRole("region", { name: "Image lab details" }));
    expect(detail.getAllByText("Needs setup").length).toBeGreaterThan(0);
    expect(detail.getByText("IMAGE_PROVIDER_API_KEY")).toBeInTheDocument();
    expect(detail.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
