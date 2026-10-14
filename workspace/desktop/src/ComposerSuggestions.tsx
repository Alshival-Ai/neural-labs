import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Keep suggestions inside their app window, but outside the compact composer's
// scrolling footer. A larger z-index cannot escape that footer's clipping.
export function ComposerSuggestions({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const marker = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setHost(marker.current?.closest<HTMLElement>(".neura-main") ?? null); }, []);
  useLayoutEffect(() => {
    const shell = marker.current?.closest<HTMLElement>(".composer-shell");
    const popup = menu.current;
    if (!host || !shell || !popup) return;
    const position = () => {
      const frame = host.getBoundingClientRect(), anchor = shell.getBoundingClientRect();
      const scale = frame.width ? host.offsetWidth / frame.width : 1;
      const room = Math.max(0, (anchor.top - frame.top) * scale - 8);
      Object.assign(popup.style, {
        left: `${Math.max(0, (anchor.left - frame.left) * scale)}px`,
        right: `${Math.max(0, (frame.right - anchor.right) * scale)}px`,
        bottom: `${(frame.bottom - anchor.top) * scale + 8}px`,
        maxHeight: `${Math.min(400, room)}px`,
      });
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(host); observer.observe(shell);
    if (shell.parentElement) observer.observe(shell.parentElement);
    host.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => { observer.disconnect(); host.removeEventListener("scroll", position, true); window.removeEventListener("resize", position); };
  }, [host, children]);
  return <><span ref={marker} hidden />{host && createPortal(
    <div ref={menu} className="skill-mention-menu" id={id} role="listbox" aria-label={label}>{children}</div>, host,
  )}</>;
}
