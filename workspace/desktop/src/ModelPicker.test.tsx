import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelPicker } from "./ModelPicker";
import type { ProviderCatalog } from "./modelProviders";

const catalog: ProviderCatalog = { agentId: "main", fetchedAt: "2026-09-05T00:00:00Z", stale: false, models: [
  { id: "openai/new-model", name: "New model", provider: "openai", available: true, unavailableReason: null, efforts: [{ id: "xhigh", label: "Extra high" }], defaultEffort: "xhigh", supportsTools: true, input: ["text"] },
] };
afterEach(cleanup);
describe("shared model picker", () => {
  it("uses runtime models and efforts, and retains a removed saved override", () => {
    const view = render(<ModelPicker catalog={catalog} model="openai/new-model" effort="xhigh" onChange={vi.fn()} />);
    expect(screen.getByRole("option", { name: "Extra high" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "ultra" })).not.toBeInTheDocument();
    view.rerender(<ModelPicker catalog={catalog} model="openai/old-pin" effort="off" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("openai/old-pin");
    expect(screen.getByRole("combobox", { name: "Reasoning" })).toHaveValue("off");
  });
  it("clears incompatible effort only when the user changes the model", () => {
    const onChange = vi.fn();
    render(<ModelPicker catalog={catalog} model="" effort="off" onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), { target: { value: "openai/new-model" } });
    expect(onChange).toHaveBeenCalledWith("openai/new-model", "");
  });
});
