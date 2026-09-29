import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { AutomationReview } from "./AutomationReview";
import { PLACEHOLDER_AUTOMATIONS } from "./AutomationsApp";
import { configureNativeActor, nativeSelection, selectNativeConnection } from "./nativeApi";

beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
it("reviews with an explicit scheduled selection without changing personal chat selection", async () => {
  configureNativeActor("member", "csrf"); selectNativeConnection({ connection: "personal", model: "personal-model" });
  let reviewCalls = 0; const requests: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (url === "/api/runtime/connections") return Response.json({ connections: [{ id: "background", label: "Background Claude", scope: "background", method: "subscription", enabled: true }] });
    const body = JSON.parse(init.body); requests.push(body);
    if (body.operation === "models.list") return Response.json({ models: [{ id: "native-model", name: "Native model", available: true }] });
    if (++reviewCalls === 1) throw new Error("Uncertain response");
    return Response.json({ accepted: false });
  }));
  const onReviewed = vi.fn(), onClose = vi.fn();
  render(<AutomationReview job={{ ...PLACEHOLDER_AUTOMATIONS[0]!, configRevision: "source-hash", enabled: false }} onReviewed={onReviewed} onClose={onClose} />);
  const submit = screen.getByRole("button", { name: "Assign account and release hold" });
  expect(submit).toBeDisabled();
  await screen.findByRole("option", { name: /Background Claude/ });
  fireEvent.change(screen.getByLabelText("Scheduled connection"), { target: { value: "background" } });
  fireEvent.click(screen.getByRole("button", { name: "Load models" }));
  await screen.findByRole("option", { name: "Native model" });
  fireEvent.change(screen.getByLabelText("Scheduled model"), { target: { value: "native-model" } });
  fireEvent.change(screen.getByLabelText("Workspace access"), { target: { value: "read-only" } });
  fireEvent.change(screen.getByLabelText("Missed occurrences"), { target: { value: "skip" } });
  fireEvent.change(screen.getByLabelText("Overlapping runs"), { target: { value: "forbid" } });
  fireEvent.click(submit); await screen.findByRole("alert");
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit); await waitFor(() => expect(onReviewed).toHaveBeenCalledOnce());
  const reviews = requests.filter(row => row.operation === "jobs.review");
  expect(reviews[0]).toEqual(reviews[1]);
  expect(reviews[0]).toMatchObject({ selection: { connection: "background", model: "native-model" }, params: { expectedRevision: "source-hash", missedRunPolicy: "skip", executionPolicy: { sandbox: "read-only", approval: "on-request" } } });
  expect(nativeSelection()).toEqual({ connection: "personal", model: "personal-model" });
  expect(onClose).toHaveBeenCalledOnce();
});
