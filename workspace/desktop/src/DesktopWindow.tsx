import { Minus, Square, X } from "lucide-react";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { readDeviceState, writeDeviceState } from "./deviceState";
import { clampBounds, initialBounds, moveBounds, resizeBounds, type Bounds, type ResizeEdge } from "./windowGeometry";

const STORAGE_PREFIX = "neural-labs.desktop";
const EDGES: ResizeEdge[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

type Props = {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  onMinimize: () => void;
  onClose: () => void;
  onActivate?: () => void;
  onMaximizedChange?: (maximized: boolean) => void;
  storageKey: string;
  storageNamespace?: string;
  active?: boolean;
  minimized?: boolean;
  zIndex?: number;
  cascadeIndex?: number;
  controls?: "all" | "close";
};

type StoredWindowState = { bounds: Bounds; maximized: boolean };

function validBounds(value: unknown): value is Bounds {
  if (!value || typeof value !== "object") return false;
  const bounds = value as Record<string, unknown>;
  return [bounds.x, bounds.y, bounds.width, bounds.height].every((dimension) => typeof dimension === "number" && Number.isFinite(dimension));
}

function loadWindowState(storageNamespace: string | undefined, storageKey: string, cascadeIndex: number): StoredWindowState {
  try {
    const saved = readDeviceState(storageNamespace, `window.${storageKey}`);
    if (saved && typeof saved === "object") {
      const record = saved as Record<string, unknown>;
      if (validBounds(record.bounds)) return {
        bounds: clampBounds(record.bounds, window.innerWidth, window.innerHeight),
        maximized: record.maximized === true,
      };
    }
    const value = localStorage.getItem(`${STORAGE_PREFIX}.${storageKey}.bounds.v1`);
    const legacy = value ? JSON.parse(value) : undefined;
    if (validBounds(legacy)) return { bounds: clampBounds(legacy, window.innerWidth, window.innerHeight), maximized: false };
  } catch {
    // Use the centered default when old local state is invalid.
  }
  const fallback = initialBounds(window.innerWidth, window.innerHeight);
  const offset = Math.max(0, (cascadeIndex - 1) % 6) * 24;
  return { bounds: clampBounds({ ...fallback, x: fallback.x + offset, y: fallback.y + offset }, window.innerWidth, window.innerHeight), maximized: false };
}

export function DesktopWindow({ title, icon, children, onMinimize, onClose, onActivate, onMaximizedChange, storageKey, storageNamespace, active, minimized = false, zIndex, cascadeIndex = 1, controls = "all" }: Props) {
  const [initial] = useState(() => loadWindowState(storageNamespace, storageKey, cascadeIndex));
  const [bounds, setBounds] = useState(initial.bounds);
  const [maximized, setMaximized] = useState(controls === "all" && initial.maximized);
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 760);
  const restoreBounds = useRef(bounds);
  const maximizedChange = useRef(onMaximizedChange);
  maximizedChange.current = onMaximizedChange;

  useEffect(() => {
    const handleResize = () => {
      setNarrow(window.innerWidth <= 760);
      setBounds((current) => clampBounds(current, window.innerWidth, window.innerHeight));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!narrow) writeDeviceState(storageNamespace, `window.${storageKey}`, { bounds, maximized } satisfies StoredWindowState);
  }, [bounds, maximized, narrow, storageKey, storageNamespace]);

  useEffect(() => {
    maximizedChange.current?.(maximized && !narrow);
  }, [maximized, narrow]);

  const beginPointerOperation = (
    event: ReactPointerEvent,
    operation: "move" | ResizeEdge,
  ) => {
    if (narrow || maximized || event.button !== 0) return;
    event.preventDefault();
    const origin = bounds;
    const originX = event.clientX;
    const originY = event.clientY;
    const handleMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - originX;
      const dy = moveEvent.clientY - originY;
      setBounds(
        operation === "move"
          ? moveBounds(origin, dx, dy, window.innerWidth, window.innerHeight)
          : resizeBounds(origin, operation, dx, dy, window.innerWidth, window.innerHeight),
      );
    };
    const handleEnd = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      document.body.classList.remove("is-manipulating-window");
    };
    document.body.classList.add("is-manipulating-window");
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd, { once: true });
  };

  const toggleMaximize = () => {
    if (narrow) return;
    if (maximized) {
      setBounds(restoreBounds.current);
      setMaximized(false);
    } else {
      restoreBounds.current = bounds;
      setMaximized(true);
    }
  };

  const boundsStyle = narrow
    ? undefined
    : maximized
      ? ({ left: 0, top: 0, width: "100vw", height: "100dvh" } satisfies CSSProperties)
      : ({ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height } satisfies CSSProperties);
  const style = { ...boundsStyle, zIndex } satisfies CSSProperties;

  return (
    <section
      className={`desktop-window${maximized ? " is-maximized" : ""}${narrow ? " is-mobile" : ""}${active ? " is-active" : ""}`}
      style={style}
      hidden={minimized}
      aria-label={`${title} application`}
      onPointerDownCapture={onActivate}
      onFocusCapture={onActivate}
    >
      <header className="window-titlebar" onPointerDown={(event) => beginPointerOperation(event, "move")} onDoubleClick={controls === "all" ? toggleMaximize : undefined}>
        <div className="window-identity">{icon}<strong>{title}</strong></div>
        <div className="window-controls" onPointerDown={(event) => event.stopPropagation()}>
          {controls === "all" && <button type="button" onClick={onMinimize} aria-label={`Minimize ${title}`}><Minus /></button>}
          {controls === "all" && <button type="button" onClick={toggleMaximize} aria-label={maximized ? `Restore ${title}` : `Maximize ${title}`}><Square /></button>}
          <button type="button" className="window-close" onClick={onClose} aria-label={`Close ${title}`}><X /></button>
        </div>
      </header>
      <div className="window-content">{children}</div>
      {!narrow && !maximized && EDGES.map((edge) => (
        <div
          key={edge}
          className={`resize-handle resize-${edge}`}
          aria-hidden="true"
          onPointerDown={(event) => beginPointerOperation(event, edge)}
        />
      ))}
    </section>
  );
}
