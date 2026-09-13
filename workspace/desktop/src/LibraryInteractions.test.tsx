import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TitleTooltip, useLibraryResize } from "./LibraryInteractions";
import { deviceStateKey } from "./deviceState";

function Pane({ userId = "example" }: { userId?: string }) {
  const resize = useLibraryResize(userId, "test-list", 288);
  return <div ref={resize.containerRef} style={resize.style}>{resize.separator}</div>;
}
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Library interactions", () => {
  it("shows complete titles on hover and focus, closes on Escape and preserves clicks", () => {
    const click = vi.fn();
    render(<TitleTooltip title="A complete, long workflow title"><button onClick={click}>A complete…</button></TitleTooltip>);
    const button = screen.getByRole("button");
    fireEvent.mouseEnter(button);
    expect(screen.getByRole("tooltip")).toHaveTextContent("A complete, long workflow title");
    expect(button).toHaveAttribute("aria-describedby", screen.getByRole("tooltip").id);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.focus(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("supports keyboard bounds, reset, and per-user persisted widths", () => {
    const view = render(<Pane />);
    const divider = screen.getByRole("separator");
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(divider).toHaveAttribute("aria-valuenow", "298");
    fireEvent.keyDown(divider, { key: "End" });
    expect(divider).toHaveAttribute("aria-valuenow", "520");
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(divider).toHaveAttribute("aria-valuenow", "520");
    fireEvent.keyDown(divider, { key: "Home" });
    expect(divider).toHaveAttribute("aria-valuenow", "200");
    fireEvent.doubleClick(divider);
    expect(divider).toHaveAttribute("aria-valuenow", "288");
    fireEvent.keyDown(divider, { key: "ArrowRight", shiftKey: true });
    view.unmount();
    const reopened = render(<Pane />);
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "328");
    reopened.rerender(<Pane userId="another-user" />);
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "288");
  });

  it("clamps widths when the container shrinks without overwriting the preference", () => {
    let observe: (() => void) | undefined;
    let width = 1000;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width } as DOMRect));
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { observe = callback; } observe() {} disconnect() {} });
    localStorage.setItem(deviceStateKey("example", "test-list"), "480");
    render(<Pane />);
    width = 620; act(() => observe?.());
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "300");
    width = 1000; act(() => observe?.());
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "480");
  });

  it("handles pointer dragging, cancellation and unavailable storage", () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Unavailable"); });
    render(<Pane />);
    const divider = screen.getByRole("separator");
    fireEvent.pointerDown(divider, { clientX: 288, button: 0 });
    fireEvent.pointerMove(divider, { clientX: 360 });
    expect(divider).toHaveAttribute("aria-valuenow", "360");
    fireEvent.pointerCancel(divider);
    fireEvent.pointerMove(divider, { clientX: 420 });
    expect(divider).toHaveAttribute("aria-valuenow", "360");
  });
});
