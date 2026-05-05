"use client";

import { useEffect, useRef, useState } from "react";

export type WindowSnapZone =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface WindowFrameState {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  snappedZone: WindowSnapZone | null;
  restoreBounds:
    | {
        x: number;
        y: number;
        width: number;
        height: number;
        snappedZone: WindowSnapZone | null;
      }
    | null;
}

type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

interface WorkspaceBounds {
  width: number;
  height: number;
}

interface DragState {
  mode: "drag";
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  currentX: number;
  currentY: number;
  width: number;
  height: number;
  snapZone: WindowSnapZone | null;
}

interface ResizeState {
  mode: "resize";
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  originWidth: number;
  originHeight: number;
  direction: ResizeDirection;
}

type InteractionState = DragState | ResizeState;

const WINDOW_GAP = 12;
const MIN_WINDOW_WIDTH = 420;
const MIN_WINDOW_HEIGHT = 280;
const SNAP_THRESHOLD = 28;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function detectSnapZone(
  x: number,
  y: number,
  width: number,
  height: number,
  workspaceBounds: WorkspaceBounds
): WindowSnapZone | null {
  const nearLeft = x <= SNAP_THRESHOLD;
  const nearRight = x + width >= workspaceBounds.width - SNAP_THRESHOLD;
  const nearTop = y <= SNAP_THRESHOLD;
  const nearBottom = y + height >= workspaceBounds.height - SNAP_THRESHOLD;

  if (nearTop && nearLeft) {
    return "top-left";
  }
  if (nearTop && nearRight) {
    return "top-right";
  }
  if (nearBottom && nearLeft) {
    return "bottom-left";
  }
  if (nearBottom && nearRight) {
    return "bottom-right";
  }
  if (nearLeft) {
    return "left";
  }
  if (nearRight) {
    return "right";
  }
  if (nearTop) {
    return "top";
  }
  if (nearBottom) {
    return "bottom";
  }

  return null;
}

export function DesktopWindowFrame({
  windowState,
  workspaceBounds,
  active,
  accent,
  children,
  onFocus,
  onMove,
  onResize,
  onSnap,
  onSnapPreview,
  onClose,
  onMinimize,
  onToggleMaximize,
}: {
  windowState: WindowFrameState;
  workspaceBounds: WorkspaceBounds;
  active: boolean;
  accent?: string;
  children: React.ReactNode;
  onFocus: () => void;
  onMove: (position: { x: number; y: number }) => void;
  onResize: (bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  onSnap: (zone: WindowSnapZone) => void;
  onSnapPreview: (zone: WindowSnapZone | null) => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
}) {
  const [interaction, setInteraction] = useState<InteractionState | null>(null);
  const interactionRef = useRef<InteractionState | null>(null);

  useEffect(() => {
    interactionRef.current = interaction;
  }, [interaction]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const current = interactionRef.current;
      if (!current) {
        return;
      }

      const deltaX = event.clientX - current.startX;
      const deltaY = event.clientY - current.startY;

      if (current.mode === "drag") {
        const maxX = Math.max(
          WINDOW_GAP,
          workspaceBounds.width - windowState.width - WINDOW_GAP
        );
        const maxY = Math.max(
          WINDOW_GAP,
          workspaceBounds.height - windowState.height - WINDOW_GAP
        );
        const nextPosition = {
          x: clamp(current.originX + deltaX, WINDOW_GAP, maxX),
          y: clamp(current.originY + deltaY, WINDOW_GAP, maxY),
        };
        const snapZone = detectSnapZone(
          nextPosition.x,
          nextPosition.y,
          current.width,
          current.height,
          workspaceBounds
        );
        onMove(nextPosition);
        if (snapZone !== current.snapZone) {
          onSnapPreview(snapZone);
        }
        interactionRef.current = {
          ...current,
          currentX: nextPosition.x,
          currentY: nextPosition.y,
          snapZone,
        };
        return;
      }

      let x = current.originX;
      let y = current.originY;
      let width = current.originWidth;
      let height = current.originHeight;

      if (current.direction.includes("e")) {
        width = clamp(
          current.originWidth + deltaX,
          MIN_WINDOW_WIDTH,
          Math.max(
            MIN_WINDOW_WIDTH,
            workspaceBounds.width - current.originX - WINDOW_GAP
          )
        );
      }

      if (current.direction.includes("s")) {
        height = clamp(
          current.originHeight + deltaY,
          MIN_WINDOW_HEIGHT,
          Math.max(
            MIN_WINDOW_HEIGHT,
            workspaceBounds.height - current.originY - WINDOW_GAP
          )
        );
      }

      if (current.direction.includes("w")) {
        const nextX = clamp(
          current.originX + deltaX,
          WINDOW_GAP,
          current.originX + current.originWidth - MIN_WINDOW_WIDTH
        );
        width = current.originWidth - (nextX - current.originX);
        x = nextX;
      }

      if (current.direction.includes("n")) {
        const nextY = clamp(
          current.originY + deltaY,
          WINDOW_GAP,
          current.originY + current.originHeight - MIN_WINDOW_HEIGHT
        );
        height = current.originHeight - (nextY - current.originY);
        y = nextY;
      }

      onResize({ x, y, width, height });
    }

    function finishInteraction(shouldSnap: boolean) {
      const current = interactionRef.current;
      if (current?.mode === "drag") {
        onSnapPreview(null);
        if (shouldSnap && current.snapZone) {
          onSnap(current.snapZone);
        }
      }
      setInteraction(null);
      interactionRef.current = null;
    }

    function handlePointerUp() {
      finishInteraction(true);
    }

    function handlePointerCancel() {
      finishInteraction(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [
    onMove,
    onResize,
    onSnap,
    onSnapPreview,
    windowState.height,
    windowState.width,
    workspaceBounds.height,
    workspaceBounds.width,
  ]);

  if (windowState.minimized) {
    return null;
  }

  const resizeHandles: Array<{ direction: ResizeDirection; className: string }> = [
    { direction: "n", className: "nl-window__resize nl-window__resize--n" },
    { direction: "ne", className: "nl-window__resize nl-window__resize--ne" },
    { direction: "e", className: "nl-window__resize nl-window__resize--e" },
    { direction: "se", className: "nl-window__resize nl-window__resize--se" },
    { direction: "s", className: "nl-window__resize nl-window__resize--s" },
    { direction: "sw", className: "nl-window__resize nl-window__resize--sw" },
    { direction: "w", className: "nl-window__resize nl-window__resize--w" },
    { direction: "nw", className: "nl-window__resize nl-window__resize--nw" },
  ];

  return (
    <section
      className={`nl-window ${active ? "nl-window--active" : ""}`}
      style={{
        width: windowState.width,
        height: windowState.height,
        transform: `translate(${windowState.x}px, ${windowState.y}px)`,
        zIndex: windowState.zIndex,
      }}
      onPointerDown={onFocus}
    >
      <header
        className={`nl-window__header ${
          windowState.maximized ? "nl-window__header--maximized" : ""
        }`}
        onDoubleClick={() => onToggleMaximize()}
        onPointerDown={(event) => {
          if (
            windowState.maximized ||
            (event.target as HTMLElement).closest("button")
          ) {
            return;
          }
          onFocus();
          onSnapPreview(null);
          setInteraction({
            mode: "drag",
            startX: event.clientX,
            startY: event.clientY,
            originX: windowState.x,
            originY: windowState.y,
            currentX: windowState.x,
            currentY: windowState.y,
            width: windowState.width,
            height: windowState.height,
            snapZone: null,
          });
        }}
      >
        <div className="nl-window__title-wrap">
          <div className="nl-window__traffic">
            <button
              type="button"
              aria-label={`Close ${windowState.title}`}
              className="nl-window__traffic-light nl-window__traffic-light--close"
              onClick={onClose}
            />
            <button
              type="button"
              aria-label={`Minimize ${windowState.title}`}
              className="nl-window__traffic-light nl-window__traffic-light--minimize"
              onClick={onMinimize}
            />
            <button
              type="button"
              aria-label={
                windowState.maximized
                  ? `Restore ${windowState.title}`
                  : `Maximize ${windowState.title}`
              }
              className="nl-window__traffic-light nl-window__traffic-light--accent"
              onClick={onToggleMaximize}
            />
          </div>
          <span className="nl-window__title">{windowState.title}</span>
        </div>
      </header>
      <div className="nl-window__body">{children}</div>

      {!windowState.maximized
        ? resizeHandles.map((handle) => (
            <div
              key={handle.direction}
              className={handle.className}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onFocus();
                onSnapPreview(null);
                setInteraction({
                  mode: "resize",
                  direction: handle.direction,
                  startX: event.clientX,
                  startY: event.clientY,
                  originX: windowState.x,
                  originY: windowState.y,
                  originWidth: windowState.width,
                  originHeight: windowState.height,
                });
              }}
            />
          ))
        : null}
    </section>
  );
}
