import { describe, expect, it } from "vitest";
import { implementationRequest, latestActionablePlan, planningRequest, planningTranscript, PLAN_REQUEST, IMPLEMENT_REQUEST } from "./neuraPlanning";
import type { NeuraMessage } from "./types";

describe("application planning over ordinary chat", () => {
  const request: NeuraMessage = { id: "u", role: "user", text: planningRequest("Build a report", "plan") };
  const answer: NeuraMessage = { id: "a", role: "assistant", text: "First inspect the data." };

  it("recovers a plan from durable messages without private protocol metadata", () => {
    const transcript = planningTranscript([request, answer]);
    expect(request.text).toBe(PLAN_REQUEST + "Build a report");
    expect(transcript[0].text).toBe("Build a report");
    expect(latestActionablePlan(transcript)).toMatchObject({ id: "a", proposedPlan: true });
    expect(implementationRequest(transcript[1])).toBe(IMPLEMENT_REQUEST + answer.text);
    expect(answer.proposedPlan).toBeUndefined();
    expect(planningRequest("hello", "default")).toBe("hello");
  });

  it("never offers incomplete or superseded plans", () => {
    expect(latestActionablePlan(planningTranscript([request, { ...answer, pending: true }]))).toBeUndefined();
    const next: NeuraMessage = { id: "next", role: "user", text: "Actually, stop." };
    expect(latestActionablePlan(planningTranscript([request, answer, next]))).toBeUndefined();
    expect(latestActionablePlan(planningTranscript([request, next, answer]))).toBeUndefined();
    expect(() => implementationRequest({ ...answer, pending: true })).toThrow(/completed plan/);
  });

  it("keeps old plan signatures readable without making ordinary answers plans", () => {
    expect(latestActionablePlan(planningTranscript([{ ...answer, proposedPlan: true }]))?.id).toBe("a");
    expect(latestActionablePlan(planningTranscript([answer]))).toBeUndefined();
  });
});
