import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { exchangeRealtimeOffer, supportedRecorderMimeType } from "./voiceApi";
import type { TeamAttachment, TeamChannel } from "./teamChat";

export type VoiceMode = "tap" | "hold";
const microphoneError = (error: unknown) =>
  error instanceof DOMException && error.name === "NotAllowedError"
    ? "Microphone access was denied. Allow microphone access in your browser and try again."
    : error instanceof Error
      ? error.message
      : "Could not access the microphone.";

export function usePrivateNeuraVoice(
  context: string | undefined,
  mode: VoiceMode,
  notify: (message: string) => void,
) {
  const [state, setState] = useState<"idle" | "connecting" | "live">("idle");
  const [muted, setMuted] = useState(false);
  const [holding, setHolding] = useState(false);
  const phase = useRef(state);
  phase.current = state;
  const generation = useRef(0);
  const stream = useRef<MediaStream | undefined>(undefined);
  const peer = useRef<RTCPeerConnection | undefined>(undefined);
  const audio = useRef<HTMLAudioElement | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const request = useRef<AbortController | undefined>(undefined);
  const current = useRef({ mode, muted, holding, notify });
  current.current = { mode, muted, holding, notify };
  const held = useRef(false);
  const muteRef = useRef(false);
  const syncMic = useCallback(() => {
    const enabled =
      !muteRef.current && (current.current.mode === "tap" || held.current);
    stream.current?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }, []);
  const stop = useCallback(() => {
    generation.current++;
    request.current?.abort();
    request.current = undefined;
    clearTimeout(timer.current);
    if (peer.current) {
      peer.current.onconnectionstatechange = null;
      peer.current.ontrack = null;
      peer.current.close();
    }
    stream.current?.getTracks().forEach((track) => track.stop());
    if (audio.current) {
      audio.current.pause();
      audio.current.srcObject = null;
    }
    peer.current = undefined;
    stream.current = undefined;
    audio.current = undefined;
    held.current = false;
    muteRef.current = false;
    setState("idle");
    setHolding(false);
    setMuted(false);
  }, []);
  useEffect(() => {
    stop();
    return stop;
  }, [context, stop]);
  useLayoutEffect(syncMic, [mode, syncMic]);
  const release = useCallback(() => {
    if (request.current && phase.current !== "live") {
      stop();
      return;
    }
    held.current = false;
    setHolding(false);
    syncMic();
  }, [stop, syncMic]);
  useEffect(() => {
    const pause = () => {
      if (current.current.mode === "hold") release();
    };
    const visibility = () => {
      if (document.hidden) pause();
    };
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", pause);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [release]);
  const start = async () => {
    if (request.current || peer.current || !context) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof RTCPeerConnection === "undefined"
    ) {
      notify("This browser does not support Neura voice chat.");
      return;
    }
    const id = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    setState("connecting");
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (id !== generation.current) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = acquired;
      syncMic();
      const connection = new RTCPeerConnection();
      peer.current = connection;
      acquired
        .getTracks()
        .forEach((track) => connection.addTrack(track, acquired));
      const output = document.createElement("audio");
      output.autoplay = true;
      audio.current = output;
      connection.ontrack = (event) => {
        output.srcObject = event.streams[0] ?? null;
      };
      connection.onconnectionstatechange = () => {
        if (
          id === generation.current &&
          ["failed", "closed", "disconnected"].includes(
            connection.connectionState,
          )
        )
          stop();
      };
      const events = connection.createDataChannel("oai-events");
      events.addEventListener("open", () => {
        if (id === generation.current)
          events.send(
            JSON.stringify({
              type: "response.create",
              response: {
                instructions:
                  "Greet the user briefly as Neura, then ask how you can help.",
              },
            }),
          );
      });
      const offer = await connection.createOffer();
      if (id !== generation.current) return;
      await connection.setLocalDescription(offer);
      const result = await exchangeRealtimeOffer(
        offer.sdp ?? "",
        controller.signal,
      );
      if (id !== generation.current) return;
      await connection.setRemoteDescription({
        type: "answer",
        sdp: result.answer,
      });
      if (id !== generation.current) return;
      setState("live");
      timer.current = setTimeout(
        () => {
          stop();
          current.current.notify(
            "The five-minute Neura voice session has ended.",
          );
        },
        Math.min(300, result.maxSeconds) * 1000,
      );
    } catch (error) {
      if (id !== generation.current) return;
      stop();
      current.current.notify(microphoneError(error));
    }
  };
  return {
    state,
    muted,
    holding,
    transmitting: state === "live" && !muted && (mode === "tap" || holding),
    stop,
    release,
    toggleMute: () => {
      muteRef.current = !muteRef.current;
      setMuted(muteRef.current);
      syncMic();
    },
    tap: () => {
      if (request.current || peer.current) stop();
      else void start();
    },
    press: () => {
      held.current = true;
      setHolding(true);
      syncMic();
      void start();
    },
  };
}

export type PendingVoiceMemo = {
  audio: Blob;
  url: string;
  channel: TeamChannel;
  filename: string;
  clientRequestId: string;
  transcript?: string;
  attachment?: TeamAttachment;
};

export function useTeamVoiceMemo(
  channel: TeamChannel | undefined,
  deliver: (
    memo: PendingVoiceMemo,
    transcribe: boolean,
    signal: AbortSignal,
  ) => Promise<void>,
  notify: (message: string) => void,
) {
  const [state, setState] = useState<
    "idle" | "starting" | "recording" | "sending"
  >("idle");
  const [seconds, setSeconds] = useState(0);
  const [pending, setPending] = useState<PendingVoiceMemo>();
  const [error, setError] = useState("");
  const memoRef = useRef<PendingVoiceMemo | undefined>(undefined);
  const active = useRef(false);
  const generation = useRef(0);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const stream = useRef<MediaStream | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const request = useRef<AbortController | undefined>(undefined);
  const latest = useRef({ deliver, notify });
  latest.current = { deliver, notify };
  const cancel = useCallback(() => {
    generation.current++;
    active.current = false;
    clearInterval(timer.current);
    if (recorder.current) {
      recorder.current.onstop = null;
      recorder.current.ondataavailable = null;
      recorder.current.onerror = null;
      if (recorder.current.state === "recording") recorder.current.stop();
    }
    stream.current?.getTracks().forEach((track) => track.stop());
    recorder.current = undefined;
    stream.current = undefined;
    request.current?.abort();
    request.current = undefined;
    setState("idle");
    setSeconds(0);
  }, []);
  const discard = useCallback(() => {
    cancel();
    if (memoRef.current) URL.revokeObjectURL(memoRef.current.url);
    memoRef.current = undefined;
    setPending(undefined);
    setError("");
  }, [cancel]);
  useEffect(() => {
    cancel();
    return cancel;
  }, [channel?.id, cancel]);
  useEffect(
    () => () => {
      if (memoRef.current) URL.revokeObjectURL(memoRef.current.url);
    },
    [],
  );
  const send = async (memo: PendingVoiceMemo, transcribe = true) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setState("sending");
    setError("");
    try {
      await latest.current.deliver(memo, transcribe, controller.signal);
      if (!controller.signal.aborted) discard();
    } catch (caught) {
      if (!controller.signal.aborted)
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not send the voice memo.",
        );
    } finally {
      if (request.current === controller) {
        request.current = undefined;
        setState("idle");
      }
    }
  };
  const finish = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    else if (active.current) cancel(); // Release before microphone permission resolves.
  };
  const start = async () => {
    if (!channel || active.current || memoRef.current || request.current)
      return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      notify("This browser does not support recording voice memos.");
      return;
    }
    const id = ++generation.current;
    active.current = true;
    setState("starting");
    setError("");
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (id !== generation.current) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = acquired;
      const mimeType = supportedRecorderMimeType();
      const capture = new MediaRecorder(
        acquired,
        mimeType ? { mimeType } : undefined,
      );
      recorder.current = capture;
      const chunks: Blob[] = [];
      let bytes = 0;
      capture.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
          bytes += event.data.size;
          if (bytes > 25 * 1024 * 1024) {
            cancel();
            latest.current.notify("Voice memos must be 25 MB or smaller.");
          }
        }
      };
      capture.onerror = () => {
        cancel();
        latest.current.notify(
          "The voice memo could not be recorded. Please try again.",
        );
      };
      capture.onstop = () => {
        clearInterval(timer.current);
        acquired.getTracks().forEach((track) => track.stop());
        stream.current = undefined;
        recorder.current = undefined;
        active.current = false;
        if (id !== generation.current) return;
        const audio = new Blob(chunks, {
          type: capture.mimeType || mimeType || "audio/webm",
        });
        setSeconds(0);
        setState("idle");
        if (!audio.size) {
          latest.current.notify("The voice memo was empty.");
          return;
        }
        const clientRequestId = crypto.randomUUID();
        const memo = {
          audio,
          channel,
          url: URL.createObjectURL(audio),
          clientRequestId,
          filename: `${Date.now()}-${clientRequestId.slice(0, 8)}-voice-memo`,
        };
        memoRef.current = memo;
        setPending(memo);
        void send(memo);
      };
      capture.start(1000);
      setState("recording");
      setSeconds(0);
      const startedAt = Date.now();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        setSeconds(elapsed);
        if (elapsed >= 300) finish();
      }, 1000);
    } catch (caught) {
      if (id === generation.current) {
        cancel();
        latest.current.notify(microphoneError(caught));
      }
    }
  };
  return {
    state,
    seconds,
    pending,
    error,
    start,
    finish,
    cancel,
    discard,
    retry: (transcribe = true) => {
      if (memoRef.current && memoRef.current.channel.id === channel?.id)
        void send(memoRef.current, transcribe);
    },
  };
}
