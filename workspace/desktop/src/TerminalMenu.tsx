import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type TerminalMenuAnchor = { element: HTMLElement; x: number; y: number };
export type TerminalMenuAction = { label: string; detail?: string; icon: ReactNode; danger?: boolean; disabled?: boolean; run: () => void };

/** Portal into the drawer when present so mobile actions remain inside its modal focus boundary. */
export function TerminalMenu({ anchor, label, actions, onClose }: {
  anchor: TerminalMenuAnchor;
  label: string;
  actions: TerminalMenuAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const menu = ref.current!;
    const doc = anchor.element.ownerDocument;
    const view = doc.defaultView!;
    const viewport = view.visualViewport;
    const anchorBounds = anchor.element.getBoundingClientRect();
    menu.style.maxWidth = `${(viewport?.width ?? view.innerWidth) - 16}px`;
    menu.style.maxHeight = `${(viewport?.height ?? view.innerHeight) - 16}px`;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    menu.style.left = `${Math.max(left + 8, Math.min(anchor.x, left + (viewport?.width ?? view.innerWidth) - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(top + 8, Math.min(anchor.y, top + (viewport?.height ?? view.innerHeight) - menu.offsetHeight - 8))}px`;
    (menu.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? menu).focus({ preventScroll: true });
    const dismiss = () => closeRef.current();
    const outside = (event: Event) => { if (!menu.contains(event.target as Node) && !anchor.element.contains(event.target as Node)) dismiss(); };
    const scroll = (event: Event) => {
      if (menu.contains(event.target as Node)) return;
      const bounds = anchor.element.getBoundingClientRect();
      // A scroll-to-anchor event may arrive after the click that opened us.
      if (Math.abs(bounds.top - anchorBounds.top) > 1 || Math.abs(bounds.left - anchorBounds.left) > 1) dismiss();
    };
    doc.addEventListener("pointerdown", outside);
    doc.addEventListener("scroll", scroll, true);
    view.addEventListener("resize", dismiss);
    viewport?.addEventListener("resize", dismiss);
    return () => {
      doc.removeEventListener("pointerdown", outside);
      doc.removeEventListener("scroll", scroll, true);
      view.removeEventListener("resize", dismiss);
      viewport?.removeEventListener("resize", dismiss);
    };
  }, [anchor]);

  return createPortal(<div ref={ref} tabIndex={-1} className="terminal-menu" role="menu" aria-label={label} onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
    event.stopPropagation();
    if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); onClose(); return; }
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const index = buttons.indexOf(event.currentTarget.ownerDocument.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }}>
    <div className="terminal-menu__label">{label}</div>
    {actions.map((action) => <button key={action.label} type="button" role="menuitem" disabled={action.disabled} className={action.danger ? "is-danger" : undefined} onClick={() => { onClose(); action.run(); }}>
      {action.icon}<span><strong>{action.label}</strong>{action.detail && <small>{action.detail}</small>}</span>
    </button>)}
  </div>, anchor.element.closest("dialog") ?? anchor.element.ownerDocument.body);
}
