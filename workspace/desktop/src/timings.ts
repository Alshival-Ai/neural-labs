// Fixed metric names and numeric durations only. Never attach request content,
// session identifiers, account details, provider errors or credentials.
export function timing(name: "session-load" | "provider-check" | "gateway-handshake" | "run-submission" | "first-response", started: number) {
  console.debug("neural-labs-timing", name, Math.round(performance.now() - started));
}
