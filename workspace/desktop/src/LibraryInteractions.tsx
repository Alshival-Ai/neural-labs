import { cloneElement, useEffect, useId, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { readDeviceState, writeDeviceState } from "./deviceState";
import "./library-interactions.css";

/** A title stays available even when its row is clipped inside a scrolling pane. */
export function TitleTooltip({ title, children }: { title: string; children: ReactElement<HTMLAttributes<HTMLElement>> }) {
  const id = useId();
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const focused = useRef(false);
  const open = Boolean(position);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const close = () => { clearTimeout(timer.current); setPosition(undefined); };
  const show = (target: HTMLElement) => {
    clearTimeout(timer.current);
    const bounds = target.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - 328)), top: Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - 100)) });
  };
  const hide = () => { if (!focused.current) timer.current = setTimeout(close, 120); };
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", escape);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { clearTimeout(timer.current); window.removeEventListener("keydown", escape); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open]);
  return <>{cloneElement(children, {
    "aria-describedby": [children.props["aria-describedby"], position ? id : undefined].filter(Boolean).join(" ") || undefined,
    onMouseEnter: event => { children.props.onMouseEnter?.(event); show(event.currentTarget); },
    onMouseLeave: event => { children.props.onMouseLeave?.(event); hide(); },
    onFocus: event => { focused.current = true; children.props.onFocus?.(event); show(event.currentTarget); },
    onBlur: event => { focused.current = false; children.props.onBlur?.(event); close(); },
    onClick: event => { close(); children.props.onClick?.(event); },
  })}{position && createPortal(<div id={id} role="tooltip" className="library-title-tooltip" style={{ ...position, maxHeight: window.innerHeight - position.top - 8 }} onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={hide}>{title}</div>, document.body)}</>;
}

export function useLibraryResize(userId: string | undefined, area: string, defaultWidth: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [preferred, setPreferred] = useState(defaultWidth);
  const [available, setAvailable] = useState(1000);
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);
  const maximum = Math.max(200, Math.min(520, available - 320));
  const width = Math.max(200, Math.min(preferred, maximum));
  useEffect(() => {
    const saved = readDeviceState(userId, area);
    setPreferred(typeof saved === "number" && Number.isFinite(saved) ? Math.max(200, Math.min(saved, 520)) : defaultWidth);
  }, [userId, area, defaultWidth]);
  // Observe the active pane after navigation as well as window resizing.
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setAvailable(element.getBoundingClientRect().width));
    observer.observe(element);
    return () => observer.disconnect();
  });
  const change = (next: number) => {
    const clamped = Math.max(200, Math.min(next, maximum));
    setPreferred(clamped);
    writeDeviceState(userId, area, clamped);
  };
  const separator = <div className="library-resizer" role="separator" aria-label="Resize list" aria-orientation="vertical" aria-valuemin={200} aria-valuemax={maximum} aria-valuenow={Math.round(width)} aria-valuetext={`${Math.round(width)} pixels`} tabIndex={0}
    title="Drag to resize · Arrow keys to adjust · Double-click to reset"
    onDoubleClick={() => change(defaultWidth)}
    onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      change(event.key === "Home" ? 200 : event.key === "End" ? maximum : width + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 40 : 10));
    }}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); drag.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture?.(event.pointerId); }}
    onPointerMove={event => { if (drag.current) change(drag.current.width + event.clientX - drag.current.x); }}
    onPointerUp={event => { drag.current = undefined; if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = undefined; }} onLostPointerCapture={() => { drag.current = undefined; }}><span /></div>;
  return { containerRef, style: { "--library-width": `${width}px` } as CSSProperties, separator };
}
