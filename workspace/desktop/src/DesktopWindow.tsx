import { Minus, PanelTopOpen, PictureInPicture2, Square, X } from "lucide-react";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  onPopOut?: () => void;
  onPopIn?: () => void;
  popoutContainer?: HTMLElement;
  surfaceStyle?: CSSProperties;
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

export function DesktopWindow({ title, icon, children, onMinimize, onClose, onActivate, onMaximizedChange, onPopOut, onPopIn, popoutContainer, surfaceStyle, storageKey, storageNamespace, active, minimized = false, zIndex, cascadeIndex = 1, controls = "all" }: Props) {
  const [initial] = useState(() => loadWindowState(storageNamespace, storageKey, cascadeIndex));
  const [bounds, setBounds] = useState(initial.bounds);
  const [maximized, setMaximized] = useState(controls === "all" && initial.maximized);
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 760);
  const [portalHost] = useState(() => {
    const host = document.createElement("div");
    host.className = "desktop-window-host";
    return host;
  });
  const inlineContainer = useRef<HTMLDivElement>(null);
  const restoreBounds = useRef(bounds);
  const maximizedChange = useRef(onMaximizedChange);
  maximizedChange.current = onMaximizedChange;
  const poppedOut = Boolean(popoutContainer);

  useLayoutEffect(() => {
    const target = popoutContainer ?? inlineContainer.current;
    if (!target) return;
    target.append(portalHost);
    return () => {
      if (portalHost.parentNode === target) target.removeChild(portalHost);
    };
  }, [popoutContainer, portalHost]);

  useEffect(() => {
    const browserWindow = popoutContainer?.ownerDocument.defaultView ?? window;
    const handleResize = () => {
      setNarrow(browserWindow.innerWidth <= 760);
      if (!popoutContainer) setBounds((current) => clampBounds(current, browserWindow.innerWidth, browserWindow.innerHeight));
    };
    handleResize();
    browserWindow.addEventListener("resize", handleResize);
    return () => browserWindow.removeEventListener("resize", handleResize);
  }, [popoutContainer]);

  useEffect(() => {
    if (!narrow) writeDeviceState(storageNamespace, `window.${storageKey}`, { bounds, maximized } satisfies StoredWindowState);
  }, [bounds, maximized, narrow, storageKey, storageNamespace]);

  useEffect(() => {
    maximizedChange.current?.(maximized && !narrow && !poppedOut);
  }, [maximized, narrow, poppedOut]);

  const beginPointerOperation = (
    event: ReactPointerEvent,
    operation: "move" | ResizeEdge,
  ) => {
    if (narrow || maximized || poppedOut || event.button !== 0) return;
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

  const boundsStyle = poppedOut
    ? ({ left: 0, top: 0, width: "100vw", height: "100dvh" } satisfies CSSProperties)
    : narrow
    ? undefined
    : maximized
      ? ({ left: 0, top: 0, width: "100vw", height: "100dvh" } satisfies CSSProperties)
      : ({ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height } satisfies CSSProperties);
  const style = { ...surfaceStyle, ...boundsStyle, zIndex } satisfies CSSProperties;

  const windowContent = (
    <section
      className={`desktop-window${maximized ? " is-maximized" : ""}${narrow ? " is-mobile" : ""}${active || poppedOut ? " is-active" : ""}${poppedOut ? " is-popped-out" : ""}`}
      style={style}
      hidden={minimized}
      aria-label={`${title} application`}
      onPointerDownCapture={onActivate}
      onFocusCapture={onActivate}
    >
      <header className="window-titlebar" onPointerDown={(event) => beginPointerOperation(event, "move")} onDoubleClick={controls === "all" && !poppedOut ? toggleMaximize : undefined}>
        <div className="window-identity">{icon}<strong>{title}</strong></div>
        <div className="window-controls" onPointerDown={(event) => event.stopPropagation()}>
          {controls === "all" && !poppedOut && <button type="button" className="window-minimize" onClick={onMinimize} aria-label={`Minimize ${title}`} title="Minimize"><Minus /></button>}
          {controls === "all" && !poppedOut && <button type="button" className="window-maximize" onClick={toggleMaximize} aria-label={maximized ? `Restore ${title}` : `Maximize ${title}`} title={maximized ? "Restore" : "Maximize"}><Square /></button>}
          {controls === "all" && !poppedOut && onPopOut && <button type="button" className="window-popout" onClick={onPopOut} aria-label={`Pop out ${title}`} title="Open in a separate browser window"><PictureInPicture2 /></button>}
          {controls === "all" && poppedOut && onPopIn && <button type="button" className="window-popin" onClick={onPopIn} aria-label={`Pop ${title} back into desktop`} title="Return to Neural Labs desktop"><PanelTopOpen /></button>}
          <button type="button" className="window-close" onClick={onClose} aria-label={`Close ${title}`} title="Close"><X /></button>
        </div>
      </header>
      <div className="window-content">{children}</div>
      {!narrow && !maximized && !poppedOut && EDGES.map((edge) => (
        <div
          key={edge}
          className={`resize-handle resize-${edge}`}
          aria-hidden="true"
          onPointerDown={(event) => beginPointerOperation(event, edge)}
        />
      ))}
    </section>
  );

  return (
    <>
      <div className="desktop-window-slot" ref={inlineContainer} />
      {createPortal(windowContent, portalHost)}
    </>
  );
}
