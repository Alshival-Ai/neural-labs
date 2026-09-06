import { useRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDrawer } from "./AppDrawer";
import { useMobileAppLayout } from "./useMobileAppLayout";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("mobile app layout", () => {
  it("reserves dock space, responds to a soft keyboard, and cleans up on desktop", () => {
    const viewport = Object.assign(new EventTarget(), {
      height: 800,
      offsetTop: 0,
    });
    vi.stubGlobal("visualViewport", viewport);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.className === "dock"
          ? new DOMRect(80, 740, 230, 50)
          : new DOMRect(0, 100, 390, 700);
      },
    );
    function Layout({ mobile }: { mobile: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      useMobileAppLayout(ref, mobile);
      return (
        <>
          <main>
            <div ref={ref} data-testid="app" />
          </main>
          <nav className="dock" />
        </>
      );
    }
    const app = render(<Layout mobile />);
    const root = screen.getByTestId("app");
    expect(root.style.getPropertyValue("--mobile-app-height")).toBe("700px");
    expect(root.style.getPropertyValue("--mobile-app-inset")).toBe("68px");
    act(() => {
      viewport.height = 460;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(root.style.getPropertyValue("--mobile-app-height")).toBe("360px");
    expect(root.style.getPropertyValue("--mobile-app-inset")).toBe("0px");
    act(() => {
      viewport.offsetTop = 30;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(root.style.getPropertyValue("--mobile-app-height")).toBe("390px");
    app.rerender(<Layout mobile={false} />);
    expect(root.style.getPropertyValue("--mobile-app-height")).toBe("");
    expect(root.style.getPropertyValue("--mobile-app-inset")).toBe("");
  });

  it("keeps drawer focus out of closed action menus and dismisses only backdrop taps", () => {
    const close = vi.fn();
    function Drawer() {
      const anchor = useRef<HTMLElement>(null);
      return (
        <section ref={anchor}>
          <AppDrawer
            id="history"
            label="History"
            anchor={anchor}
            onClose={close}
          >
            <input aria-label="Search" />
            <details>
              <summary>Actions</summary>
              <button>Hidden delete</button>
            </details>
          </AppDrawer>
        </section>
      );
    }
    render(<Drawer />);
    const dialog = screen.getByRole("dialog");
    const dismiss = within(dialog).getByRole("button", {
      name: "Close history",
    });
    expect(dismiss).toHaveFocus();
    fireEvent.keyDown(dismiss, { key: "Tab", shiftKey: true });
    expect(screen.getByText("Actions")).toHaveFocus();
    fireEvent.keyDown(screen.getByText("Actions"), { key: "Tab" });
    expect(dismiss).toHaveFocus();
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 64, 330, 700),
    );
    fireEvent.click(dialog, { clientX: 10, clientY: 100 });
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(dialog, { clientX: 375, clientY: 100 });
    expect(close).toHaveBeenCalledOnce();
  });
});
