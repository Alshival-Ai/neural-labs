import { Mic, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import type { VoiceMode } from "./useNeuraVoice";

export function VoiceControl({
  mode,
  onModeChange,
  label,
  disabled,
  busy,
  active,
  lockMode,
  showModeToggle = true,
  onTap,
  onHoldStart,
  onHoldEnd,
}: {
  mode: VoiceMode;
  onModeChange: (mode: VoiceMode) => void;
  label: string;
  disabled?: boolean;
  busy?: boolean;
  active?: boolean;
  lockMode?: boolean;
  showModeToggle?: boolean;
  onTap: () => void;
  onHoldStart: () => void;
  onHoldEnd: (cancelled: boolean) => void;
}) {
  const holding = useRef(false);
  const endRef = useRef(onHoldEnd);
  endRef.current = onHoldEnd;
  const end = (cancelled: boolean) => {
    if (holding.current) {
      holding.current = false;
      endRef.current(cancelled);
    }
  };
  useEffect(() => {
    const cancel = () => end(true);
    const visibility = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancel();
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return (
    <div className="voice-send-control">
      <button
        type="button"
        className={`send-button voice-send-button${active ? " is-live" : ""}`}
        aria-label={label}
        title={
          mode === "hold" ? `${label} · hold pointer, Space, or Enter` : label
        }
        disabled={disabled}
        aria-busy={busy}
        onClick={() => {
          if (mode === "tap") onTap();
        }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (mode !== "hold" || event.button !== 0 || holding.current) return;
          event.preventDefault();
          holding.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          onHoldStart();
        }}
        onPointerUp={() => end(false)}
        onPointerCancel={() => end(true)}
        onLostPointerCapture={() => end(true)}
        onBlur={() => end(true)}
        onKeyDown={(event) => {
          if (mode !== "hold" || ![" ", "Enter"].includes(event.key)) return;
          event.preventDefault();
          if (!event.repeat && !holding.current) {
            holding.current = true;
            onHoldStart();
          }
        }}
        onKeyUp={(event) => {
          if ([" ", "Enter"].includes(event.key) && mode === "hold") {
            event.preventDefault();
            end(false);
          }
        }}
      >
        {busy ? (
          <span className="activity-spinner" />
        ) : active && mode === "tap" ? (
          <Square />
        ) : (
          <Mic />
        )}
      </button>
      {showModeToggle && <button
        type="button"
        className="voice-mode-toggle"
        role="switch"
        aria-label="Hold to talk"
        aria-checked={mode === "hold"}
        title={
          mode === "tap"
            ? "Open microphone mode. Switch to hold-to-talk."
            : "Hold-to-talk mode. Switch to open microphone."
        }
        disabled={lockMode || busy}
        onClick={() => onModeChange(mode === "tap" ? "hold" : "tap")}
      >
        {mode === "tap" ? "Open" : "Hold"}
      </button>}
    </div>
  );
}
