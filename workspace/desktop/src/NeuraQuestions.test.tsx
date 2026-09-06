import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NeuraQuestions } from "./NeuraQuestions";
import { normalizeNeuraQuestion, type NeuraGateway } from "./openclaw";
import type { GatewayEvent } from "./types";

afterEach(cleanup);
const request = { id: "q-1", sessionKey: "private-1", agentId: "agent-1", status: "pending", expiresAtMs: Date.now() + 60_000,
  questions: [{ questionId: "approach", header: "Approach", question: "Which approach?", options: [{ label: "Small change", description: "Keep the existing structure." }, { label: "Refactor" }], isOther: true }],
};

describe("Neura planning questions", () => {
  it("restores pending questions, requires an explicit answer, and keeps failed answers editable", async () => {
    let listener: ((event: GatewayEvent) => void) | undefined;
    const gateway = {
      listQuestions: vi.fn(async () => normalizeNeuraQuestion(request, "private-1", "agent-1")),
      onEvent: (callback: typeof listener) => { listener = callback; return () => { listener = undefined; }; },
      resolveQuestion: vi.fn().mockRejectedValueOnce(new Error("Disconnected")).mockResolvedValue(undefined),
    };
    const notify = vi.fn();
    render(<NeuraQuestions gateway={gateway as unknown as NeuraGateway} sessionKey="private-1" notify={notify} />);
    const submit = await screen.findByRole("button", { name: "Submit answers" });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Small change/ }));
    fireEvent.click(submit);
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Disconnected"));
    fireEvent.change(screen.getByLabelText("Your own answer"), { target: { value: "Start with a prototype" } });
    fireEvent.click(submit);
    await waitFor(() => expect(gateway.resolveQuestion).toHaveBeenLastCalledWith("q-1", { approach: ["Start with a prototype"] }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Questions from Neura" })).not.toBeInTheDocument());
    gateway.listQuestions.mockResolvedValue([]);
    act(() => listener?.({ event: "question.resolved", payload: { id: "q-1" } }));
    await waitFor(() => expect(gateway.listQuestions).toHaveBeenCalledTimes(2));
  });

  it("does not show questions from another agent/session, expired questions, or secret-store requests", () => {
    for (const patch of [{ agentId: "other" }, { sessionKey: "other" }, { expiresAtMs: 1 }, { status: "answered" }, { questions: [{ ...request.questions[0], secretStore: { name: "SECRET" } }] }]) {
      expect(normalizeNeuraQuestion({ ...request, ...patch }, "private-1", "agent-1")).toEqual([]);
    }
  });
});
