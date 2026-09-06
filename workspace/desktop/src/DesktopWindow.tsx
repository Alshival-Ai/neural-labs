import { Minus, PanelTopOpen, PictureInPicture2, Square, X } from "lucide-react";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AppViewportProvider, appViewportForWidth } from "./appViewport";
import { readDeviceState, writeDeviceState } from "./deviceState";
import { clampBounds, initialBounds, moveBounds, resizeBounds, snapBounds, snapTarget, type WindowPlacement, type SnapTarget, type Bounds, type ResizeEdge } from "./windowGeometry";

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
  onPlacementChange?: (placement: WindowPlacement) => void;
  onManipulatingChange?: (active: boolean) => void;
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

type StoredWindowState = { bounds: Bounds; placement: WindowPlacement; preMaximize: Exclude<WindowPlacement, "maximized"> };
function placement(value: unknown): value is WindowPlacement { return ["freeform", "left", "right", "maximized"].includes(value as string); }

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
        bounds: window.innerWidth > 760 ? clampBounds(record.bounds, window.innerWidth, window.innerHeight, 0) : record.bounds,
        placement: placement(record.placement) ? record.placement : record.maximized === true ? "maximized" : "freeform",
        preMaximize: record.preMaximize === "left" || record.preMaximize === "right" ? record.preMaximize : "freeform",
      };
    }
    const value = localStorage.getItem(`${STORAGE_PREFIX}.${storageKey}.bounds.v1`);
    const legacy = value ? JSON.parse(value) : undefined;
    if (validBounds(legacy)) return { bounds: window.innerWidth > 760 ? clampBounds(legacy, window.innerWidth, window.innerHeight, 0) : legacy, placement: "freeform", preMaximize: "freeform" };
  } catch {
    // Use the centered default when old local state is invalid.
  }
  const fallback = initialBounds(window.innerWidth, window.innerHeight);
  const offset = Math.max(0, (cascadeIndex - 1) % 6) * 24;
  return { bounds: clampBounds({ ...fallback, x: fallback.x + offset, y: fallback.y + offset }, window.innerWidth, window.innerHeight), placement: "freeform", preMaximize: "freeform" };
}

export function DesktopWindow({ title, icon, children, onMinimize, onClose, onActivate, onMaximizedChange, onPlacementChange, onManipulatingChange, onPopOut, onPopIn, popoutContainer, surfaceStyle, storageKey, storageNamespace, active, minimized = false, zIndex, cascadeIndex = 1, controls = "all" }: Props) {
  const [initial] = useState(() => loadWindowState(storageNamespace, storageKey, cascadeIndex));
  const [state, setState] = useState<StoredWindowState>(() => controls === "all" ? initial : { ...initial, placement: "freeform" });
  const { bounds } = state;
  const maximized = state.placement === "maximized";
  const [preview, setPreview] = useState<SnapTarget | null>(null);
  const [layoutMenu, setLayoutMenu] = useState(false);
  const menuElement = useRef<HTMLDivElement>(null);
  const maximizeButton = useRef<HTMLButtonElement>(null);
  const cancelOperation = useRef<(() => void) | null>(null);
  const placementChange = useRef(onPlacementChange);
  const manipulatingChange = useRef(onManipulatingChange);
  placementChange.current = onPlacementChange;
  manipulatingChange.current = onManipulatingChange;
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight, top: 0 }));
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 760);
  const [browserWidth, setBrowserWidth] = useState(() => (popoutContainer?.ownerDocument.defaultView ?? window).innerWidth);
  const [portalHost] = useState(() => {
    const host = document.createElement("div");
    host.className = "desktop-window-host";
    return host;
  });
  const inlineContainer = useRef<HTMLDivElement>(null);
  const windowElement = useRef<HTMLElement>(null);
  const maximizedChange = useRef(onMaximizedChange);
  const activateWindow = useRef(onActivate);
  maximizedChange.current = onMaximizedChange;
  activateWindow.current = onActivate;
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
      setBrowserWidth(browserWindow.innerWidth);
      setNarrow(browserWindow.innerWidth <= 760);
      if (!popoutContainer) {
        cancelOperation.current?.();
        const top = 0;
        setViewport({ width: browserWindow.innerWidth, height: browserWindow.innerHeight, top });
        if (browserWindow.innerWidth > 760) setState((current) => ({ ...current, bounds: clampBounds(current.bounds, browserWindow.innerWidth, browserWindow.innerHeight, top) }));
      }
    };
    handleResize();
    browserWindow.addEventListener("resize", handleResize);
    return () => browserWindow.removeEventListener("resize", handleResize);
  }, [popoutContainer]);

  useEffect(() => {
    if (!narrow && !poppedOut && !cancelOperation.current) writeDeviceState(storageNamespace, `window.${storageKey}`, { ...state, maximized });
  }, [state, maximized, narrow, poppedOut, storageKey, storageNamespace]);

  useEffect(() => {
    maximizedChange.current?.(maximized && !narrow && !poppedOut);
    placementChange.current?.(!narrow && !poppedOut && !minimized ? state.placement : "freeform");
  }, [maximized, state.placement, narrow, poppedOut, minimized]);

  useEffect(() => { if (minimized || poppedOut) { cancelOperation.current?.(); setLayoutMenu(false); } }, [minimized, poppedOut]);
  useEffect(() => () => { cancelOperation.current?.(); placementChange.current?.("freeform"); }, []);
  useEffect(() => {
    if (!layoutMenu) return;
    menuElement.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => { if (!menuElement.current?.contains(event.target as Node) && !maximizeButton.current?.contains(event.target as Node)) setLayoutMenu(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [layoutMenu]);

  useEffect(() => {
    const surface = windowElement.current;
    if (!surface || !activateWindow.current) return;
    const frameCleanups = new Map<HTMLIFrameElement, () => void>();
    const activate = () => activateWindow.current?.();
    const attachFrame = (frame: HTMLIFrameElement) => {
      if (frameCleanups.has(frame)) return;
      let detachInner = () => {};
      const attachInner = () => {
        detachInner();
        detachInner = () => {};
        try {
          const frameWindow = frame.contentWindow;
          const frameDocument = frame.contentDocument;
          if (!frameWindow || !frameDocument) return;
          frameWindow.addEventListener("pointerdown", activate, true);
          frameWindow.addEventListener("focus", activate, true);
          frameDocument.addEventListener("focusin", activate, true);
          detachInner = () => {
            frameWindow.removeEventListener("pointerdown", activate, true);
            frameWindow.removeEventListener("focus", activate, true);
            frameDocument.removeEventListener("focusin", activate, true);
          };
        } catch {
          // Cross-origin frames are covered by the outer focus/blur fallback.
        }
      };
      frame.addEventListener("focus", activate);
      frame.addEventListener("load", attachInner);
      attachInner();
      frameCleanups.set(frame, () => {
        detachInner();
        frame.removeEventListener("focus", activate);
        frame.removeEventListener("load", attachInner);
      });
    };
    const syncFrames = () => {
      const currentFrames = new Set(surface.querySelectorAll("iframe"));
      for (const [frame, cleanup] of frameCleanups) {
        if (currentFrames.has(frame)) continue;
        cleanup();
        frameCleanups.delete(frame);
      }
      for (const frame of currentFrames) attachFrame(frame);
    };
    const detectFocusedFrame = () => {
      const focused = surface.ownerDocument.activeElement;
      if (focused?.tagName === "IFRAME" && surface.contains(focused)) activate();
    };
    const ownerWindow = surface.ownerDocument.defaultView;
    const detectAfterBlur = () => ownerWindow?.setTimeout(detectFocusedFrame, 0);
    const observer = new MutationObserver(syncFrames);
    syncFrames();
    observer.observe(surface, { childList: true, subtree: true });
    surface.ownerDocument.addEventListener("focusin", detectFocusedFrame, true);
    ownerWindow?.addEventListener("blur", detectAfterBlur);
    return () => {
      observer.disconnect();
      surface.ownerDocument.removeEventListener("focusin", detectFocusedFrame, true);
      ownerWindow?.removeEventListener("blur", detectAfterBlur);
      for (const cleanup of frameCleanups.values()) cleanup();
      frameCleanups.clear();
    };
  }, [popoutContainer]);

  useEffect(() => {
    const surface = windowElement.current;
    if (!surface || active || poppedOut) return;
    const focused = surface.ownerDocument.activeElement;
    if (focused && surface.contains(focused) && "blur" in focused) (focused as HTMLElement).blur();
  }, [active, poppedOut]);

  const displayedBounds = state.placement === "freeform" ? bounds : snapBounds(state.placement, viewport.width, viewport.height, viewport.top);
  const applyPlacement = (next: WindowPlacement) => {
    setLayoutMenu(false);
    setState((current) => ({ ...current, placement: next,
      preMaximize: next === "maximized" && current.placement !== "maximized" ? current.placement : current.preMaximize }));
  };
  const toggleMaximize = () => { if (!narrow) applyPlacement(maximized ? state.preMaximize : "maximized"); };
  const beginPointerOperation = (event: ReactPointerEvent, operation: "move" | ResizeEdge) => {
    if (narrow || poppedOut || event.button !== 0 || (maximized && operation !== "move")) return;
    cancelOperation.current?.();
    event.preventDefault();
    setLayoutMenu(false);
    const original = state;
    let origin = displayedBounds;
    let originX = event.clientX;
    let originY = event.clientY;
    let moved = false;
    let target: SnapTarget | null = null;
    let latest = state;
    const pointerId = event.pointerId;
    const element = event.currentTarget as HTMLElement;
    element.setPointerCapture?.(pointerId);
    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!moved && Math.hypot(moveEvent.clientX - originX, moveEvent.clientY - originY) < 6) return;
      if (!moved) {
        moved = true;
        windowElement.current?.focus({ preventScroll: true });
        manipulatingChange.current?.(true);
        document.body.classList.add("is-manipulating-window");
        if (operation === "move" && original.placement !== "freeform") {
          const ratio = Math.max(0, Math.min(1, (originX - origin.x) / origin.width));
          origin = clampBounds({ ...original.bounds, x: moveEvent.clientX - original.bounds.width * ratio, y: moveEvent.clientY - Math.min(24, originY - origin.y) }, viewport.width, viewport.height, viewport.top);
          originX = moveEvent.clientX; originY = moveEvent.clientY;
        }
      }
      const nextBounds = operation === "move"
        ? moveBounds(origin, moveEvent.clientX - originX, moveEvent.clientY - originY, viewport.width, viewport.height, viewport.top)
        : resizeBounds(origin, operation, moveEvent.clientX - originX, moveEvent.clientY - originY, viewport.width, viewport.height, viewport.top);
      latest = { ...original, bounds: nextBounds, placement: "freeform" };
      setState(latest);
      target = operation === "move" && controls === "all" ? snapTarget(moveEvent.clientX, moveEvent.clientY, viewport.width, viewport.height, viewport.top) : null;
      setPreview(target);
    };
    const finish = (cancel: boolean) => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("keydown", handleKey, true);
      element.removeEventListener("lostpointercapture", handleBlur);
      cancelOperation.current = null;
      if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
      document.body.classList.remove("is-manipulating-window");
      manipulatingChange.current?.(false);
      setPreview(null);
      setState(cancel ? original : moved && target ? { ...original, placement: target, preMaximize: original.placement === "maximized" ? original.preMaximize : original.placement } : { ...latest });
    };
    const handleUp = (up: PointerEvent) => { if (up.pointerId === pointerId) finish(false); };
    const handleCancel = (cancel: PointerEvent) => { if (cancel.pointerId === pointerId) finish(true); };
    const handleBlur = () => finish(true);
    const handleKey = (key: KeyboardEvent) => { if (key.key === "Escape") { key.preventDefault(); key.stopPropagation(); finish(true); } };
    cancelOperation.current = handleBlur;
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("keydown", handleKey, true);
    element.addEventListener("lostpointercapture", handleBlur);
  };

  const boundsStyle = poppedOut
    ? ({ left: 0, top: 0, width: "100vw", height: "100dvh" } satisfies CSSProperties)
    : narrow
    ? undefined
    : maximized
      ? ({ left: 0, top: viewport.top, width: "100vw", height: viewport.top ? `calc(100dvh - ${viewport.top}px)` : "100dvh" } satisfies CSSProperties)
      : ({ left: displayedBounds.x, top: displayedBounds.y, width: displayedBounds.width, height: displayedBounds.height } satisfies CSSProperties);
  const style = { ...surfaceStyle, ...boundsStyle, zIndex } satisfies CSSProperties;
  const appWidth = poppedOut || narrow || maximized ? browserWidth : displayedBounds.width;
  const appViewport = appViewportForWidth(appWidth);

  const windowContent = (
    <AppViewportProvider width={appWidth}>
      <section
        ref={windowElement}
        tabIndex={-1}
        className={`desktop-window${maximized ? " is-maximized" : ""}${state.placement === "left" || state.placement === "right" ? " is-snapped" : ""}${narrow ? " is-mobile" : ""}${active || poppedOut ? " is-active" : ""}${poppedOut ? " is-popped-out" : ""}`}
        style={style}
        hidden={minimized}
        aria-label={`${title} application`}
        data-app-viewport={appViewport.mode}
        data-placement={state.placement}
        onPointerDownCapture={onActivate}
        onFocusCapture={onActivate}
      >
        <header className="window-titlebar" onPointerDown={(event) => beginPointerOperation(event, "move")} onDoubleClick={controls === "all" && !poppedOut ? (event) => { if (!(event.target as HTMLElement).closest("button")) toggleMaximize(); } : undefined}>
          <div className="window-identity">{icon}<strong>{title}</strong></div>
          <div className="window-controls" onPointerDown={(event) => event.stopPropagation()}>
            {controls === "all" && !poppedOut && <button type="button" className="window-minimize" onClick={onMinimize} aria-label={`Minimize ${title}`} title="Minimize"><Minus /></button>}
            {controls === "all" && !poppedOut && <button ref={maximizeButton} type="button" className="window-maximize" onClick={toggleMaximize} onContextMenu={(event) => { event.preventDefault(); setLayoutMenu(true); }} onKeyDown={(event) => { if (event.key === "ArrowDown" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); setLayoutMenu(true); } }} aria-haspopup="menu" aria-expanded={layoutMenu} aria-label={maximized ? `Restore ${title}` : `Maximize ${title}`} title={`${maximized ? "Restore" : "Maximize"} · Right-click or Arrow Down for layout`}><Square /></button>}
            {controls === "all" && !poppedOut && onPopOut && <button type="button" className="window-popout" onClick={onPopOut} aria-label={`Pop out ${title}`} title="Open in a separate browser window"><PictureInPicture2 /></button>}
            {controls === "all" && poppedOut && onPopIn && <button type="button" className="window-popin" onClick={onPopIn} aria-label={`Pop ${title} back into desktop`} title="Return to Neural Labs desktop"><PanelTopOpen /></button>}
            <button type="button" className="window-close" onClick={onClose} aria-label={`Close ${title}`} title="Close"><X /></button>
          </div>
        </header>
        {layoutMenu && <div ref={menuElement} className="window-layout-menu" role="menu" aria-label={`${title} window layout`} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
          if (event.key === "Escape") { event.stopPropagation(); setLayoutMenu(false); maximizeButton.current?.focus(); }
          if (event.key === "Tab") setLayoutMenu(false);
        }}>{([["left", "Snap left"], ["right", "Snap right"], ["maximized", "Maximize"], ["freeform", "Restore"]] as const).map(([value, label]) => <button key={value} type="button" role="menuitem" onClick={() => { applyPlacement(value); maximizeButton.current?.focus(); }}>{label}</button>)}</div>}
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
    </AppViewportProvider>
  );

  return (
    <>
      <div className="desktop-window-slot" ref={inlineContainer} />
      {createPortal(windowContent, portalHost)}
      {preview && createPortal(<div className="window-snap-preview" aria-hidden="true" data-snap-target={preview} style={(() => { const rectangle = snapBounds(preview, viewport.width, viewport.height, viewport.top); return { left: rectangle.x, top: rectangle.y, width: rectangle.width, height: rectangle.height }; })()} />, document.body)}
    </>
  );
}
