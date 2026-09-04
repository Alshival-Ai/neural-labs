import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1200 });
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 900 });
  });

  afterEach(() => {
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
