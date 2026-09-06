import { cleanup, act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactionOverlays, TerminalReactionSidebar } from "./TerminalReactions";
import { searchTerminalGifs } from "./terminalApi";
vi.mock("./terminalApi", () => ({ searchTerminalGifs: vi.fn() }));
const gif = { id: "gif-1", token: "opaque-selection", title: "Celebration", url: "https://static.klipy.com/full.gif", preview: "https://static1.klipy.com/tiny.gif", still: "https://static2.klipy.com/still.png" };
function setup(connected = true) {
  const send = vi.fn();
  render(<TerminalReactionSidebar terminalId="team-1" connected={connected} send={send} error="" dismissError={vi.fn()} />);
  return send;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); vi.mocked(searchTerminalGifs).mockReset(); });
describe("Team Terminal reaction sidebar", () => {
  it("searches the full emoji catalog, sends a skin-tone variant, and closes", async () => {
    const send = setup();
    fireEvent.click(screen.getByRole("button", { name: "Send a team reaction" }));
    fireEvent.change(screen.getByLabelText("Search emoji"), { target: { value: "woman technologist" } });
    const emoji = await screen.findByRole("button", { name: "Send Woman Technologist" });
    fireEvent.change(screen.getByLabelText("Skin tone"), { target: { value: "3" } });
    fireEvent.click(emoji);
    expect(send).toHaveBeenCalledWith({ emoji: "👩🏽‍💻" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("keeps quick reactions offline and restores trigger focus on Escape", () => {
    const send = setup(false);
    const trigger = screen.getByRole("button", { name: "Send a team reaction" });
    fireEvent.click(trigger);
    expect(screen.getByText("Reconnect to send reactions")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send 🚀" }));
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText("Search emoji"), { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("closes when focus moves to another window without stealing it back", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Send a team reaction" }));
    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => outside.focus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(outside).toHaveFocus();
    outside.remove();
  });
  it("loads featured GIFs, paginates, and sends a token without exposing a URL", async () => {
    vi.mocked(searchTerminalGifs).mockResolvedValueOnce({ results: [gif], next: "page-2" }).mockResolvedValueOnce({ results: [{ ...gif, token: "second", title: "Applause" }], next: "" });
    const send = setup();
    fireEvent.click(screen.getByRole("button", { name: "Send a GIF reaction" }));
    await screen.findByRole("button", { name: "Send Celebration" });
    expect(searchTerminalGifs).toHaveBeenCalledWith("team-1", "", "", expect.any(AbortSignal));
    fireEvent.click(screen.getByRole("button", { name: "Load more GIFs" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send Applause" }));
    expect(searchTerminalGifs).toHaveBeenLastCalledWith("team-1", "", "page-2", expect.any(AbortSignal));
    expect(send).toHaveBeenCalledWith({ kind: "gif", token: "second" });
  });
  it("cancels stale queries, debounces searches, and offers retry on provider failure", async () => {
    vi.mocked(searchTerminalGifs).mockResolvedValueOnce({ results: [gif], next: "" });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Send a GIF reaction" }));
    await screen.findByRole("button", { name: "Send Celebration" });
    vi.useFakeTimers();
    let resolveOld!: (value: { results: typeof gif[]; next: string }) => void;
    vi.mocked(searchTerminalGifs).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    fireEvent.change(screen.getByPlaceholderText("Search KLIPY"), { target: { value: "old" } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    const oldSignal = vi.mocked(searchTerminalGifs).mock.calls.at(-1)![3];
    vi.mocked(searchTerminalGifs).mockRejectedValueOnce(new Error("KLIPY unavailable"));
    fireEvent.change(screen.getByPlaceholderText("Search KLIPY"), { target: { value: "new" } });
    expect(oldSignal.aborted).toBe(true);
    await act(async () => { resolveOld({ results: [gif], next: "" }); await vi.advanceTimersByTimeAsync(299); });
    expect(searchTerminalGifs).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.queryByRole("button", { name: "Send Celebration" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("KLIPY unavailable");
    vi.mocked(searchTerminalGifs).mockResolvedValueOnce({ results: [], next: "" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(screen.getByRole("status")).toHaveTextContent("No GIFs found");
  });
  it("traps picker Tab navigation without terminal input and supports result arrow keys", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Send a team reaction" }));
    await screen.findByRole("button", { name: "Send Grinning Face" });
    const dialog = screen.getByRole("dialog");
    const quick = within(screen.getByLabelText("Quick reactions")).getAllByRole("button");
    quick[0].focus();
    fireEvent.keyDown(quick[0], { key: "ArrowRight" });
    expect(quick[1]).toHaveFocus();
    const buttons = within(dialog).getAllByRole("button");
    buttons.at(-1)!.focus();
    fireEvent.keyDown(buttons.at(-1)!, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close reactions" })).toHaveFocus();
  });
  it("uses still images for reduced motion and text when a preview is unavailable", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList));
    const { rerender } = render(<ReactionOverlays reactions={[{ id: "a", label: "Ada", gif }]} />);
    expect(screen.getByRole("img", { hidden: true })).toHaveAttribute("src", gif.still);
    fireEvent.error(screen.getByRole("img", { hidden: true }));
    expect(screen.queryByRole("img", { hidden: true })).not.toBeInTheDocument();
    rerender(<ReactionOverlays reactions={[{ id: "b", label: "Bea", gif: { ...gif, still: null } }]} />);
    await waitFor(() => expect(screen.getByText("Celebration")).toBeInTheDocument());
    expect(screen.queryByRole("img", { hidden: true })).not.toBeInTheDocument();
  });
});
