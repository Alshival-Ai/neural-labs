import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SkillHistory } from "./SkillHistory";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("loads every retained page and inspects the exact historical record", async () => {
  const requests: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    const url = String(input); requests.push(url);
    if (url.includes("history-detail")) return Response.json({ id: "proposal-2", sha256: "b".repeat(64), raw: { status: "applied", record_json: "original" }, history: [{ table: "rollback", record: { revision: "original" } }] });
    const second = url.endsWith("after=cursor");
    return Response.json({ records: [{ id: second ? "proposal-2" : "proposal-1", migration: "a".repeat(64), title: second ? "Second proposal" : "First proposal", status: "applied", sha256: "b".repeat(64) }], next: second ? null : "cursor" });
  });
  render(<SkillHistory />);
  await screen.findByRole("button", { name: /First proposal/ });
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  fireEvent.click(await screen.findByRole("button", { name: /Second proposal/ }));
  expect(await screen.findByRole("article", { name: "Retained proposal proposal-2" })).toHaveTextContent("original");
  expect(screen.getByRole("button", { name: /First proposal/ })).toBeInTheDocument();
  expect(requests[2]).toContain("id=proposal-2");
  expect(requests[2]).toContain(`migration=${"a".repeat(64)}`);
});
