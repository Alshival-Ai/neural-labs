import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  usePrivateNeuraVoice,
  useTeamVoiceMemo,
  type VoiceMode,
} from "./useNeuraVoice";
import { exchangeRealtimeOffer } from "./voiceApi";
import type { TeamChannel } from "./teamChat";

vi.mock("./voiceApi", () => ({
  exchangeRealtimeOffer: vi.fn(),
  supportedRecorderMimeType: () => "audio/webm",
}));
const channel = { id: "release", name: "release" } as TeamChannel;
let track: { enabled: boolean; stop: ReturnType<typeof vi.fn> };
let stream: MediaStream;
let getUserMedia: ReturnType<typeof vi.fn>;
class FakePeer {
  static instances: FakePeer[] = [];
  connectionState = "connected";
  onconnectionstatechange: (() => void) | null = null;
  ontrack = null;
  addTrack = vi.fn();
  close = vi.fn();
  createDataChannel = () => ({ addEventListener: vi.fn(), send: vi.fn() });
  createOffer = async () => ({ type: "offer", sdp: "v=offer" });
  setLocalDescription = vi.fn(async () => {});
  setRemoteDescription = vi.fn(async () => {});
  constructor() {
    FakePeer.instances.push(this);
  }
}
class FakeRecorder {
  static instances: FakeRecorder[] = [];
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["test audio"], { type: this.mimeType }),
    });
    this.onstop?.();
  }
}
beforeEach(() => {
  track = { enabled: true, stop: vi.fn() };
  stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  getUserMedia = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  vi.stubGlobal("RTCPeerConnection", FakePeer);
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => "blob:test-memo");
  URL.revokeObjectURL = vi.fn();
  vi.mocked(exchangeRealtimeOffer)
    .mockReset()
    .mockResolvedValue({ answer: "v=answer", maxSeconds: 300 });
  FakePeer.instances = [];
  FakeRecorder.instances = [];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("private Neura voice", () => {
  it("mutes the microphone track and stops all media on hangup", async () => {
    const { result } = renderHook(() =>
      usePrivateNeuraVoice("session", "tap", vi.fn()),
    );
    act(() => result.current.tap());
    await waitFor(() => expect(result.current.state).toBe("live"));
    act(() => result.current.toggleMute());
    expect(track.enabled).toBe(false);
    act(() => result.current.toggleMute());
    expect(track.enabled).toBe(true);
    act(() => result.current.stop());
    expect(result.current.state).toBe("idle");
    expect(track.stop).toHaveBeenCalled();
    expect(FakePeer.instances[0].close).toHaveBeenCalled();
  });
  it("transmits only while held, respects mute, and applies mode changes immediately", async () => {
    const { result, rerender } = renderHook(
      ({ mode }: { mode: VoiceMode }) =>
        usePrivateNeuraVoice("session", mode, vi.fn()),
      { initialProps: { mode: "hold" as VoiceMode } },
    );
    act(() => result.current.press());
    await waitFor(() => expect(result.current.state).toBe("live"));
    expect(track.enabled).toBe(true);
    act(() => result.current.release());
    expect(track.enabled).toBe(false);
    act(() => result.current.toggleMute());
    act(() => result.current.press());
    expect(track.enabled).toBe(false);
    act(() => result.current.toggleMute());
    expect(track.enabled).toBe(true);
    act(() => window.dispatchEvent(new Event("blur")));
    expect(track.enabled).toBe(false);
    rerender({ mode: "tap" });
    expect(track.enabled).toBe(true);
    rerender({ mode: "hold" });
    expect(track.enabled).toBe(false);
  });
  it("cancels a released hold while microphone permission is pending", async () => {
    let grant!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        grant = resolve;
      }),
    );
    const { result } = renderHook(() =>
      usePrivateNeuraVoice("session", "hold", vi.fn()),
    );
    act(() => result.current.press());
    act(() => result.current.release());
    await act(async () => grant(stream));
    expect(result.current.state).toBe("idle");
    expect(track.stop).toHaveBeenCalled();
    expect(exchangeRealtimeOffer).not.toHaveBeenCalled();
  });
  it("aborts setup on chat switch and ignores a late answer", async () => {
    let answer!: (value: { answer: string; maxSeconds: number }) => void;
    vi.mocked(exchangeRealtimeOffer).mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ context }) => usePrivateNeuraVoice(context, "tap", vi.fn()),
      { initialProps: { context: "one" } },
    );
    act(() => result.current.tap());
    await waitFor(() => expect(exchangeRealtimeOffer).toHaveBeenCalled());
    const signal = vi.mocked(exchangeRealtimeOffer).mock.calls[0][1];
    rerender({ context: "two" });
    expect(signal?.aborted).toBe(true);
    await act(async () => answer({ answer: "v=late", maxSeconds: 300 }));
    expect(result.current.state).toBe("idle");
    expect(FakePeer.instances[0].setRemoteDescription).not.toHaveBeenCalled();
  });
  it("reports denied permission and releases a live call on unmount", async () => {
    const notify = vi.fn();
    getUserMedia.mockRejectedValueOnce(
      new DOMException("Denied", "NotAllowedError"),
    );
    const { result, unmount } = renderHook(() =>
      usePrivateNeuraVoice("session", "tap", notify),
    );
    act(() => result.current.tap());
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("Allow microphone access"),
      ),
    );
    act(() => result.current.tap());
    await waitFor(() => expect(result.current.state).toBe("live"));
    unmount();
    expect(track.stop).toHaveBeenCalled();
    expect(FakePeer.instances[0].close).toHaveBeenCalled();
  });
});

describe("Team voice memos", () => {
  it("retains failed audio and retries the same memo without starting another recording", async () => {
    const deliver = vi
      .fn()
      .mockRejectedValueOnce(new Error("Transcription unavailable"))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useTeamVoiceMemo(channel, deliver, vi.fn()),
    );
    await act(async () => {
      void result.current.start();
      void result.current.start();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await act(async () => result.current.finish());
    expect(result.current.error).toBe("Transcription unavailable");
    const memo = result.current.pending;
    expect(memo?.audio.size).toBeGreaterThan(0);
    expect(memo?.channel).toBe(channel);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    await act(async () => result.current.start());
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await act(async () => result.current.retry(false));
    expect(deliver).toHaveBeenLastCalledWith(
      memo,
      false,
      expect.any(AbortSignal),
    );
    expect(result.current.pending).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-memo");
  });
  it("cancels late microphone permission without posting an empty memo", async () => {
    let grant!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        grant = resolve;
      }),
    );
    const deliver = vi.fn();
    const { result } = renderHook(() =>
      useTeamVoiceMemo(channel, deliver, vi.fn()),
    );
    act(() => void result.current.start());
    act(() => result.current.finish());
    await act(async () => grant(stream));
    expect(result.current.state).toBe("idle");
    expect(track.stop).toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
  it("aborts delivery on channel change and only retries in the original channel", async () => {
    const deliver = vi.fn().mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook(
      ({ selected }) => useTeamVoiceMemo(selected, deliver, vi.fn()),
      { initialProps: { selected: channel } },
    );
    await act(async () => result.current.start());
    act(() => result.current.finish());
    const signal = deliver.mock.calls[0][2] as AbortSignal;
    rerender({ selected: { ...channel, id: "other", name: "other" } });
    expect(signal.aborted).toBe(true);
    expect(result.current.pending?.channel.id).toBe(channel.id);
    act(() => result.current.retry());
    expect(deliver).toHaveBeenCalledTimes(1);
    rerender({ selected: channel });
    act(() => result.current.retry());
    expect(deliver).toHaveBeenCalledTimes(2);
    act(() => result.current.discard());
    expect(result.current.pending).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-memo");
  });
  it("cancels recording on channel change without posting and releases media on unmount", async () => {
    const deliver = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ selected }) => useTeamVoiceMemo(selected, deliver, vi.fn()),
      { initialProps: { selected: channel } },
    );
    await act(async () => result.current.start());
    rerender({ selected: { ...channel, id: "other" } });
    expect(deliver).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
    await act(async () => result.current.start());
    unmount();
    expect(FakeRecorder.instances[1].state).toBe("inactive");
  });
});
