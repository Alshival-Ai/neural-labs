import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAppViewport } from "./appViewport";
import { DesktopWindow } from "./DesktopWindow";

function ViewportProbe() {
  const viewport = useAppViewport();
  return <output aria-label="App viewport">{`${viewport.mode}:${viewport.width}`}</output>;
}

describe("DesktopWindow app viewport", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1200 });
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 900 });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.body.classList.remove("is-manipulating-window");
    vi.restoreAllMocks();
  });

  it("updates CSS and React app viewport state while the desktop window is resized", async () => {
    const view = render(
      <DesktopWindow
        title="Skills & Automations"
        icon={<span aria-hidden="true">S</span>}
        storageKey="responsive-test"
        onMinimize={vi.fn()}
        onClose={vi.fn()}
      >
        <ViewportProbe />
      </DesktopWindow>,
    );

    const appWindow = screen.getByRole("region", { name: "Skills & Automations application" });
    expect(appWindow).toHaveAttribute("data-app-viewport", "desktop");
    expect(screen.getByLabelText("App viewport")).toHaveTextContent("desktop:1096");

    const westHandle = view.container.ownerDocument.querySelector<HTMLElement>(".resize-w");
    expect(westHandle).not.toBeNull();
    fireEvent.pointerDown(westHandle!, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 450, clientY: 0 });
    fireEvent.pointerUp(window);

    await waitFor(() => {
      expect(appWindow).toHaveAttribute("data-app-viewport", "mobile");
      expect(screen.getByLabelText("App viewport")).toHaveTextContent("mobile:646");
    });
  });

  it("activates a window when a same-origin embedded app receives a pointer", async () => {
    const onActivate = vi.fn();
    render(
      <DesktopWindow
        title="Embedded app"
        icon={<span aria-hidden="true">E</span>}
        storageKey="embedded-focus-test"
        onActivate={onActivate}
        onMinimize={vi.fn()}
        onClose={vi.fn()}
      >
        <iframe title="Embedded surface" srcDoc="<button>Inside</button>" />
      </DesktopWindow>,
    );

    const frame = screen.getByTitle("Embedded surface") as HTMLIFrameElement;
    await waitFor(() => expect(frame.contentDocument?.body).toBeTruthy());
    fireEvent.pointerDown(frame.contentDocument!.body);

    expect(onActivate).toHaveBeenCalled();
  });
});


describe("desktop placement", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(window, { innerWidth: 1280, innerHeight: 900 });
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  function mount(extra = {}) {
    return render(<DesktopWindow title="Test" icon={<span />} storageKey="snap" storageNamespace="qa" onMinimize={vi.fn()} onClose={vi.fn()} {...extra}><ViewportProbe /><input aria-label="Draft" defaultValue="Retain this" /></DesktopWindow>);
  }
  function layout(label: string) {
    fireEvent.keyDown(document.querySelector(".window-maximize")!, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("menuitem", { name: label }));
  }
  it("snaps, maximizes, restores placement and freeform bounds without remounting content", () => {
    mount();
    const region = screen.getByRole("region");
    const width = region.style.width;
    const input = screen.getByRole("textbox");
    layout("Snap left");
    expect(region).toHaveAttribute("data-placement", "left");
    expect(region.style.height).toBe("900px");
    expect(screen.getByLabelText("App viewport")).toHaveTextContent("mobile:640");
    fireEvent.click(screen.getByRole("button", { name: "Maximize Test" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore Test" }));
    expect(region).toHaveAttribute("data-placement", "left");
    layout("Restore");
    expect(region.style.width).toBe(width);
    expect(screen.getByRole("textbox")).toBe(input);
  });
  it("persists placement across reload and a temporary phone viewport", () => {
    const view = mount();
    layout("Snap right");
    Object.assign(window, { innerWidth: 390 }); fireEvent(window, new Event("resize"));
    Object.assign(window, { innerWidth: 1280 }); fireEvent(window, new Event("resize"));
    expect(screen.getByRole("region")).toHaveAttribute("data-placement", "right");
    view.unmount(); mount();
    expect(screen.getByRole("region")).toHaveAttribute("data-placement", "right");
    expect(screen.getByRole("region").style.left).toBe("640px");
  });
  it("previews a drag, cancels with Escape, and cleans up on unmount", () => {
    const manipulating = vi.fn();
    const view = mount({ onManipulatingChange: manipulating });
    const title = document.querySelector(".window-titlebar")!;
    const region = screen.getByRole("region"); const left = region.style.left;
    fireEvent.pointerDown(title, { button: 0, clientX: 400, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: 120 });
    expect(document.querySelector("[data-snap-target=left]")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(region.style.left).toBe(left);
    expect(document.querySelector(".window-snap-preview")).toBeNull();
    fireEvent.pointerDown(title, { button: 0, clientX: 400, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 1280, clientY: 120 });
    view.unmount();
    expect(document.body).not.toHaveClass("is-manipulating-window");
    expect(manipulating).toHaveBeenLastCalledWith(false);
  });
  it("reads old maximized state and ignores invalid placement metadata", () => {
    localStorage.setItem("neural-labs.device-state.v1.qa.window.snap", JSON.stringify({ bounds: { x: 100, y: 100, width: 700, height: 500 }, maximized: true, placement: "broken", preMaximize: "broken" }));
    mount();
    expect(screen.getByRole("region")).toHaveAttribute("data-placement", "maximized");
    fireEvent.click(screen.getByRole("button", { name: "Restore Test" }));
    expect(screen.getByRole("region").style.width).toBe("700px");
    expect(screen.getByRole("region")).toHaveAttribute("data-placement", "freeform");
  });
  it("commits a pointer snap, restores only after movement, and cancels pointer loss", () => {
    mount();
    const title = document.querySelector(".window-titlebar")!;
    const region = screen.getByRole("region");
    fireEvent.pointerDown(title, { button: 0, clientX: 400, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 1279, clientY: 150 });
    fireEvent.pointerUp(window);
    expect(region).toHaveAttribute("data-placement", "right");
    fireEvent.pointerDown(title, { button: 0, clientX: 750, clientY: 20 });
    fireEvent.pointerUp(window);
    expect(region).toHaveAttribute("data-placement", "right");
    fireEvent.pointerDown(title, { button: 0, clientX: 750, clientY: 20 });
    fireEvent.pointerMove(window, { clientX: 500, clientY: 140 });
    expect(region).toHaveAttribute("data-placement", "freeform");
    fireEvent.pointerCancel(window);
    expect(region).toHaveAttribute("data-placement", "right");
    expect(document.body).not.toHaveClass("is-manipulating-window");
  });
  it("resizing a snapped rectangle becomes freeform and reports normal placement", () => {
    const report = vi.fn(); mount({ onPlacementChange: report });
    layout("Snap left");
    fireEvent.pointerDown(document.querySelector(".resize-e")!, { button: 0, clientX: 640, clientY: 300 });
    fireEvent.pointerMove(window, { clientX: 700, clientY: 300 });
    fireEvent.pointerUp(window);
    expect(screen.getByRole("region")).toHaveAttribute("data-placement", "freeform");
    expect(screen.getByRole("region").style.width).toBe("700px");
    expect(report).toHaveBeenLastCalledWith("freeform");
  });

});
