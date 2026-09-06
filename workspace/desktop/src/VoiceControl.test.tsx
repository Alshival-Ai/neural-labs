import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceControl } from "./VoiceControl";

beforeEach(() => vi.stubGlobal("PointerEvent", MouseEvent));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(mode: "tap" | "hold" = "tap") {
  const props = {
    mode,
    label: "Voice",
    onModeChange: vi.fn(),
    onTap: vi.fn(),
    onHoldStart: vi.fn(),
    onHoldEnd: vi.fn(),
  };
  const view = render(<VoiceControl {...props} />);
  return { ...view, props, mic: screen.getByRole("button", { name: "Voice" }) };
}

describe("combined voice control", () => {
  it("uses clicks in open mode and exposes an Open/Hold switch", () => {
    const { props, mic } = setup();
    fireEvent.pointerDown(mic, { button: 0 });
    fireEvent.pointerUp(mic);
    fireEvent.click(mic);
    expect(props.onTap).toHaveBeenCalledTimes(1);
    expect(props.onHoldStart).not.toHaveBeenCalled();
    const mode = screen.getByRole("switch", { name: "Hold to talk" });
    expect(mode).toHaveTextContent("Open");
    expect(mode).toHaveAttribute("aria-checked", "false");
    fireEvent.click(mode);
    expect(props.onModeChange).toHaveBeenCalledWith("hold");
  });
  it("finishes a pointer hold once without a synthetic click starting another call", () => {
    const { props, mic } = setup("hold");
    fireEvent.pointerDown(mic, { button: 0 });
    fireEvent.pointerUp(mic);
    fireEvent.lostPointerCapture(mic);
    fireEvent.click(mic);
    expect(props.onHoldStart).toHaveBeenCalledTimes(1);
    expect(props.onHoldEnd).toHaveBeenCalledExactlyOnceWith(false);
    expect(props.onTap).not.toHaveBeenCalled();
  });
  it.each([" ", "Enter"])(
    "supports keyboard holds with %j and ignores repeated keydown",
    (key) => {
      const { props, mic } = setup("hold");
      fireEvent.keyDown(mic, { key });
      fireEvent.keyDown(mic, { key, repeat: true });
      fireEvent.keyUp(mic, { key });
      expect(props.onHoldStart).toHaveBeenCalledTimes(1);
      expect(props.onHoldEnd).toHaveBeenCalledExactlyOnceWith(false);
    },
  );
  it.each(["pointercancel", "blur", "unmount"])(
    "cancels a hold on %s",
    (event) => {
      const { props, mic, unmount } = setup("hold");
      fireEvent.pointerDown(mic, { button: 0 });
      if (event === "pointercancel") fireEvent.pointerCancel(mic);
      else if (event === "blur") fireEvent.blur(window);
      else unmount();
      expect(props.onHoldEnd).toHaveBeenCalledExactlyOnceWith(true);
    },
  );
  it("allows changing mode during a live call, but locks it during a memo recording", () => {
    const { props, rerender } = setup();
    rerender(<VoiceControl {...props} active />);
    expect(
      screen.getByRole("switch", { name: "Hold to talk" }),
    ).toBeEnabled();
    rerender(<VoiceControl {...props} active lockMode />);
    expect(
      screen.getByRole("switch", { name: "Hold to talk" }),
    ).toBeDisabled();
  });
  it("can hide the mode switch for a fixed hold-to-talk control", () => {
    const props = {
      mode: "hold" as const,
      label: "Hold to record",
      onModeChange: vi.fn(),
      onTap: vi.fn(),
      onHoldStart: vi.fn(),
      onHoldEnd: vi.fn(),
      showModeToggle: false,
    };
    render(<VoiceControl {...props} />);
    expect(screen.queryByRole("switch", { name: "Hold to talk" })).not.toBeInTheDocument();
    const mic = screen.getByRole("button", { name: "Hold to record" });
    fireEvent.pointerDown(mic, { button: 0 });
    fireEvent.pointerUp(mic);
    expect(props.onHoldStart).toHaveBeenCalledOnce();
    expect(props.onHoldEnd).toHaveBeenCalledExactlyOnceWith(false);
  });
});
