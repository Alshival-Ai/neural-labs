import { useLayoutEffect, type RefObject } from "react";

/** Keep app controls above the soft keyboard and the floating desktop dock. */
export function useMobileAppLayout(
  ref: RefObject<HTMLElement | null>,
  mobile: boolean,
) {
  useLayoutEffect(() => {
    const root = ref.current;
    const view = root?.ownerDocument.defaultView;
    if (!root || !view || !mobile) return;
    const update = () => {
      const rect = root.parentElement?.getBoundingClientRect();
      if (!rect?.height) return;
      const viewport = view.visualViewport;
      const visibleBottom =
        (viewport?.height || view.innerHeight) + (viewport?.offsetTop || 0);
      const bottom = Math.min(rect.bottom, visibleBottom);
      const dock = root.ownerDocument
        .querySelector(".dock")
        ?.getBoundingClientRect();
      const dockOverlap =
        dock &&
        dock.width > 0 &&
        dock.top < bottom &&
        dock.bottom > rect.top &&
        dock.left < rect.right &&
        dock.right > rect.left
          ? bottom - dock.top + 8
          : 0;
      root.style.setProperty(
        "--mobile-app-height",
        `${Math.max(0, bottom - rect.top)}px`,
      );
      root.style.setProperty(
        "--mobile-app-inset",
        `${Math.max(0, dockOverlap)}px`,
      );
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    if (root.parentElement) observer?.observe(root.parentElement);
    view.addEventListener("resize", update);
    view.visualViewport?.addEventListener("resize", update);
    view.visualViewport?.addEventListener("scroll", update);
    return () => {
      observer?.disconnect();
      view.removeEventListener("resize", update);
      view.visualViewport?.removeEventListener("resize", update);
      view.visualViewport?.removeEventListener("scroll", update);
      root.style.removeProperty("--mobile-app-height");
      root.style.removeProperty("--mobile-app-inset");
    };
  }, [ref, mobile]);
}
