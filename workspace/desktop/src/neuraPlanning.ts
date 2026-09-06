import type { NeuraMessage } from "./types";

export type NeuraComposeMode = "default" | "plan";
// A user-level request, never a permission policy or a private Gateway field.
export const PLAN_REQUEST = "Please draft a plan for the request below. Explain the proposed steps and ask any necessary questions. Do not implement the plan until I ask you to.\n\nRequest:\n";
export const IMPLEMENT_REQUEST = "Please implement the following plan:\n\n";

export function planningRequest(message: string, mode: NeuraComposeMode): string {
  return mode === "plan" ? PLAN_REQUEST + message : message;
}

export function implementationRequest(plan: NeuraMessage): string {
  if (plan.role !== "assistant" || plan.pending || !plan.text.trim()) throw new Error("Choose a completed plan to implement.");
  return IMPLEMENT_REQUEST + plan.text;
}

// Reconstruct presentation from ordinary transcript messages. Plan metadata is
// a UI hint, never proof of approval or a security boundary. Old plan signatures
// remain readable, but the client no longer writes private runtime fields.
export function planningTranscript(messages: NeuraMessage[]): NeuraMessage[] {
  let awaitingPlan = false;
  return messages.map((message) => {
    if (message.role === "user") {
      awaitingPlan = message.text.startsWith(PLAN_REQUEST);
      return awaitingPlan ? { ...message, text: message.text.slice(PLAN_REQUEST.length) } : message;
    }
    if (message.role === "assistant" && !message.pending && message.text.trim()) {
      const isPlan = awaitingPlan;
      awaitingPlan = false;
      return isPlan ? { ...message, proposedPlan: true } : message;
    }
    return message;
  });
}

export function latestActionablePlan(messages: NeuraMessage[]): NeuraMessage | undefined {
  const last = messages.findLast((message) => message.role === "user" || message.role === "assistant");
  return last?.role === "assistant" && last.proposedPlan && !last.pending ? last : undefined;
}
