import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AutomationsApp } from "./AutomationsApp";

afterEach(cleanup);

describe("Automations app prototype", () => {
  it("filters jobs needing attention and exposes enable state changes", () => {
    const onToggle = vi.fn();
    render(<AutomationsApp onToggle={onToggle} />);

    fireEvent.click(screen.getByRole("button", { name: "issues" }));
    const jobList = within(screen.getByRole("complementary", { name: "Automation jobs" }));
    expect(jobList.getByRole("button", { name: "PR checks watcher" })).toBeInTheDocument();
    expect(jobList.queryByRole("button", { name: "Shared skills review" })).not.toBeInTheDocument();
    expect(jobList.queryByRole("button", { name: "Morning team brief" })).not.toBeInTheDocument();

    fireEvent.click(jobList.getByRole("button", { name: "PR checks watcher" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable PR checks watcher" }));
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: "pr-watcher" }), true);
  });

  it("supports OpenClaw force, due, and if-enabled run modes", () => {
    const onRun = vi.fn();
    render(<AutomationsApp onRun={onRun} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose run mode" }));
    fireEvent.click(screen.getByRole("button", { name: /^Run only if due/ }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: "morning-brief" }), "due");

    fireEvent.click(screen.getByRole("button", { name: "Choose run mode" }));
    fireEvent.click(screen.getByRole("button", { name: /^Run if enabled/ }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: "morning-brief" }), "if-enabled");
  });

  it("creates a stream-triggered automation through the integration seam", () => {
    const onCreate = vi.fn();
    render(<AutomationsApp onCreate={onCreate} />);

    fireEvent.click(screen.getByRole("button", { name: "New automation" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Incident event stream" } });
    fireEvent.click(screen.getByRole("button", { name: "Stream: Live lines" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Stream command argv" }), { target: { value: '["node","scripts/incidents.mjs"]' } });
    fireEvent.change(screen.getByRole("textbox", { name: "Agent instruction" }), { target: { value: "Triage matching incident events." } });
    fireEvent.click(screen.getByRole("button", { name: "Create automation" }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: "Incident event stream",
      scheduleKind: "stream",
      payloadKind: "agentTurn",
    }));
  });
});
