import { X } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import "./app-drawer.css";

/** One modal navigation surface: background inertness, Escape, focus return, and touch dismissal. */
export function AppDrawer({
  id,
  label,
  anchor,
  onClose,
  children,
}: {
  id: string;
  label: string;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const owner = dialog.ownerDocument;
    const view = owner.defaultView!;
    const prior = owner.activeElement as HTMLElement | null;
    const place = () => {
      const bounds = anchor.current?.getBoundingClientRect();
      const viewport = view.visualViewport;
      const top = Math.max(viewport?.offsetTop || 0, bounds?.top || 0);
      const bottom = Math.min(
        bounds?.bottom || view.innerHeight,
        (viewport?.height || view.innerHeight) + (viewport?.offsetTop || 0),
      );
      dialog.style.top = `${top}px`;
      dialog.style.left = `${Math.max(0, bounds?.left || 0)}px`;
      dialog.style.height = `${Math.max(0, bottom - top)}px`;
      dialog.style.width = `${Math.min(330, Math.max(240, (bounds?.width || view.innerWidth) - 40))}px`;
    };
    place();
    dialog.showModal?.();
    if (!dialog.open) dialog.setAttribute("open", "");
    dialog
      .querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
    view.addEventListener("resize", place);
    view.visualViewport?.addEventListener("resize", place);
    view.visualViewport?.addEventListener("scroll", place);
    return () => {
      view.removeEventListener("resize", place);
      view.visualViewport?.removeEventListener("resize", place);
      view.visualViewport?.removeEventListener("scroll", place);
      dialog.close?.();
      if (prior?.isConnected) prior.focus({ preventScroll: true });
    };
  }, [anchor]);
  return (
    <dialog
      ref={ref}
      id={id}
      className="app-drawer"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
        if (event.key === "Tab") {
          const nodes = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input:not(:disabled),summary,a[href],select:not(:disabled)",
            ),
          ).filter((node) => {
            const closedDetails = node.closest("details:not([open])");
            return (
              !node.closest("[hidden]") &&
              (!closedDetails ||
                closedDetails.querySelector("summary")?.contains(node))
            );
          });
          const active = event.currentTarget.ownerDocument.activeElement;
          if (event.shiftKey && active === nodes[0]) {
            event.preventDefault();
            nodes.at(-1)?.focus();
          } else if (!event.shiftKey && active === nodes.at(-1)) {
            event.preventDefault();
            nodes[0]?.focus();
          }
        }
      }}
    >
      <header className="app-drawer__header">
        <strong>{label}</strong>
        <button
          type="button"
          aria-label={`Close ${label.toLowerCase()}`}
          onClick={onClose}
        >
          <X />
        </button>
      </header>
      <div className="app-drawer__body">{children}</div>
    </dialog>
  );
}
