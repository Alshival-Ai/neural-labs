"use client";

import { useEffect, useRef } from "react";

import { CloseIcon, MinusIcon } from "@/components/ui/icons";
import { IconButton } from "@/components/ui/primitives";

export interface WindowFrameState {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
}

export function DesktopWindowFrame({
  windowState,
  active,
  accent,
  children,
  onFocus,
  onMove,
  onClose,
  onMinimize,
}: {
  windowState: WindowFrameState;
  active: boolean;
  accent?: string;
  children: React.ReactNode;
  onFocus: () => void;
  onMove: (position: { x: number; y: number }) => void;
  onClose: () => void;
  onMinimize: () => void;
}) {
  const dragState = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!dragState.current) {
        return;
      }
      onMove({
        x: dragState.current.originX + event.clientX - dragState.current.startX,
        y: dragState.current.originY + event.clientY - dragState.current.startY,
      });
    }

    function handlePointerUp() {
      dragState.current = null;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [onMove]);

  if (windowState.minimized) {
    return null;
  }

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
        className="nl-window__header"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) {
            return;
          }
          onFocus();
          dragState.current = {
            startX: event.clientX,
            startY: event.clientY,
            originX: windowState.x,
            originY: windowState.y,
          };
        }}
      >
        <div className="nl-window__title-wrap">
          <span
            className="nl-window__accent"
            style={{ background: accent || "var(--accent)" }}
          />
          <span className="nl-window__title">{windowState.title}</span>
        </div>
        <div className="nl-window__actions">
          <IconButton label={`Minimize ${windowState.title}`} onClick={onMinimize}>
            <MinusIcon className="nl-window__icon" />
          </IconButton>
          <IconButton label={`Close ${windowState.title}`} onClick={onClose}>
            <CloseIcon className="nl-window__icon" />
          </IconButton>
        </div>
      </header>
      <div className="nl-window__body">{children}</div>
    </section>
  );
}
