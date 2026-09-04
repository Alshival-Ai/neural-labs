import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import type { TerminalVoiceMode, TerminalVoiceParticipant } from "./terminalApi";

export type TeamVoiceStatus = "idle" | "joining" | "connected" | "error";

type VoiceSignal = {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

type VoicePeer = {
  connection: RTCPeerConnection;
  sender: RTCRtpSender;
  candidates: RTCIceCandidateInit[];
  makingOffer: boolean;
  ignoreOffer: boolean;
  offered: boolean;
};

type Options = {
  sessionId: string;
  mode: TerminalVoiceMode;
  onModeChange: (mode: TerminalVoiceMode) => void;
  send: (payload: object) => void;
};

export type TeamVoice = {
  status: TeamVoiceStatus;
  participants: TerminalVoiceParticipant[];
  error?: string;
  talking: boolean;
  audioRef: RefObject<HTMLAudioElement | null>;
  join: () => Promise<void>;
  leave: () => void;
  resumeAudio: () => void;
  startTalking: () => void;
  stopTalking: () => void;
  handleReady: (connectionId: string, participants: TerminalVoiceParticipant[]) => void;
  handlePresence: (participants: TerminalVoiceParticipant[]) => void;
  handleConfig: (iceServers: RTCIceServer[]) => void;
  handleSignal: (fromConnectionId: string, actor: { id: string; label: string }, signal: VoiceSignal) => void;
  handleError: (message: string) => void;
  handleDisconnected: () => void;
};

const AUDIO_PLAYBACK_ERROR = "Click the voice control to allow audio playback.";

function voiceErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") return "Microphone access was denied. You can still join muted and listen.";
  if (error instanceof DOMException && error.name === "NotFoundError") return "No microphone was found. You can still join muted and listen.";
  return error instanceof Error ? error.message : "Voice chat could not access the microphone.";
}

function serializedDescription(description: RTCSessionDescription | RTCSessionDescriptionInit): RTCSessionDescriptionInit {
  return { type: description.type, sdp: description.sdp };
}

export function useTeamVoice({ sessionId, mode, onModeChange, send }: Options): TeamVoice {
  const [status, setStatus] = useState<TeamVoiceStatus>("idle");
  const [participants, setParticipants] = useState<TerminalVoiceParticipant[]>([]);
  const [error, setError] = useState<string>();
  const [talking, setTalking] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const modeRef = useRef(mode);
  const sendRef = useRef(send);
  const onModeChangeRef = useRef(onModeChange);
  const joinedIntent = useRef(false);
  const socketReady = useRef(false);
  const ownConnectionId = useRef<string | undefined>(undefined);
  const connected = useRef(false);
  const talkingRef = useRef(false);
  const localStream = useRef<MediaStream | undefined>(undefined);
  const remoteStream = useRef<MediaStream | undefined>(undefined);
  const peers = useRef(new Map<string, VoicePeer>());
  const participantsRef = useRef<TerminalVoiceParticipant[]>([]);
  const iceServersRef = useRef<RTCIceServer[]>([]);

  modeRef.current = mode;
  sendRef.current = send;
  onModeChangeRef.current = onModeChange;

  const updateLocalTrack = useCallback(() => {
    const enabled = connected.current && (modeRef.current === "open-mic" || (modeRef.current === "push-to-talk" && talkingRef.current));
    for (const track of localStream.current?.getAudioTracks() ?? []) track.enabled = enabled;
  }, []);

  const closePeers = useCallback(() => {
    for (const peer of peers.current.values()) peer.connection.close();
    peers.current.clear();
    for (const track of remoteStream.current?.getTracks() ?? []) remoteStream.current?.removeTrack(track);
  }, []);

  const stopMicrophone = useCallback(() => {
    for (const track of localStream.current?.getTracks() ?? []) track.stop();
    localStream.current = undefined;
  }, []);

  const ensureMicrophone = useCallback(async (): Promise<MediaStream> => {
    if (localStream.current?.getAudioTracks().some((track) => track.readyState === "live")) return localStream.current;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not support microphone access.");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    localStream.current = stream;
    updateLocalTrack();
    const track = stream.getAudioTracks()[0] ?? null;
    await Promise.all([...peers.current.values()].map((peer) => peer.sender.replaceTrack(track)));
    return stream;
  }, [updateLocalTrack]);

  const sendSignal = useCallback((targetConnectionId: string, signal: VoiceSignal) => {
    sendRef.current({ type: "voice-signal", targetConnectionId, signal });
  }, []);

  const resumeAudio = useCallback(() => {
    if (!audioRef.current?.srcObject) return;
    void audioRef.current.play()
      .then(() => setError((current) => current === AUDIO_PLAYBACK_ERROR ? undefined : current))
      .catch(() => setError(AUDIO_PLAYBACK_ERROR));
  }, []);

  const ensurePeer = useCallback((participant: TerminalVoiceParticipant): VoicePeer | undefined => {
    const existing = peers.current.get(participant.connectionId);
    if (existing) return existing;
    if (typeof RTCPeerConnection === "undefined") return undefined;
    const connection = new RTCPeerConnection({ iceServers: iceServersRef.current });
    const transceiver = connection.addTransceiver("audio", { direction: "sendrecv" });
    const peer: VoicePeer = { connection, sender: transceiver.sender, candidates: [], makingOffer: false, ignoreOffer: false, offered: false };
    peers.current.set(participant.connectionId, peer);
    const localTrack = localStream.current?.getAudioTracks()[0];
    if (localTrack) void peer.sender.replaceTrack(localTrack);
    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      sendSignal(participant.connectionId, { candidate: event.candidate.toJSON() });
    };
    connection.ontrack = (event) => {
      if (!remoteStream.current) remoteStream.current = new MediaStream();
      if (!remoteStream.current.getTracks().some((track) => track.id === event.track.id)) remoteStream.current.addTrack(event.track);
      if (audioRef.current && audioRef.current.srcObject !== remoteStream.current) audioRef.current.srcObject = remoteStream.current;
      resumeAudio();
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "failed") {
        const relayed = iceServersRef.current.some((server) => (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) => url.startsWith("turn:" ) || url.startsWith("turns:")));
        setError(relayed
          ? `A voice path to ${participant.label} could not connect, even through the relay.`
          : `A direct voice path to ${participant.label} could not connect. This network may require a TURN relay.`);
      }
    };
    return peer;
  }, [resumeAudio, sendSignal]);

  const offerPeer = useCallback(async (targetConnectionId: string, peer: VoicePeer) => {
    if (peer.makingOffer || peer.connection.signalingState === "closed") return;
    peer.makingOffer = true;
    try {
      await peer.connection.setLocalDescription(await peer.connection.createOffer());
      if (peer.connection.localDescription) sendSignal(targetConnectionId, { description: serializedDescription(peer.connection.localDescription) });
    } catch {
      setError("A voice connection could not be negotiated.");
    } finally {
      peer.makingOffer = false;
    }
  }, [sendSignal]);

  const syncPeers = useCallback((nextParticipants: TerminalVoiceParticipant[]) => {
    const ownId = ownConnectionId.current;
    if (!ownId || !joinedIntent.current) return;
    const remoteIds = new Set(nextParticipants.filter((participant) => participant.connectionId !== ownId).map((participant) => participant.connectionId));
    for (const [connectionId, peer] of peers.current) {
      if (remoteIds.has(connectionId)) continue;
      peer.connection.close();
      peers.current.delete(connectionId);
    }
    for (const participant of nextParticipants) {
      if (participant.connectionId === ownId) continue;
      const peer = ensurePeer(participant);
      if (!peer || peer.offered || ownId.localeCompare(participant.connectionId) >= 0) continue;
      peer.offered = true;
      void offerPeer(participant.connectionId, peer);
    }
  }, [ensurePeer, offerPeer]);

  const handlePresence = useCallback((nextParticipants: TerminalVoiceParticipant[]) => {
    participantsRef.current = nextParticipants;
    setParticipants(nextParticipants);
    const joined = Boolean(joinedIntent.current && ownConnectionId.current && nextParticipants.some((participant) => participant.connectionId === ownConnectionId.current));
    connected.current = joined;
    setStatus(joined ? "connected" : joinedIntent.current ? "joining" : "idle");
    updateLocalTrack();
    if (joined) syncPeers(nextParticipants);
    else closePeers();
  }, [closePeers, syncPeers, updateLocalTrack]);

  const handleReady = useCallback((connectionId: string, nextParticipants: TerminalVoiceParticipant[]) => {
    ownConnectionId.current = connectionId;
    socketReady.current = true;
    closePeers();
    participantsRef.current = nextParticipants;
    setParticipants(nextParticipants);
    if (joinedIntent.current) {
      setStatus("joining");
      sendRef.current({ type: "voice-join", mode: modeRef.current });
    }
  }, [closePeers]);

  const handleConfig = useCallback((iceServers: RTCIceServer[]) => {
    iceServersRef.current = Array.isArray(iceServers) ? iceServers : [];
  }, []);

  const handleSignal = useCallback((fromConnectionId: string, actor: { id: string; label: string }, signal: VoiceSignal) => {
    const ownId = ownConnectionId.current;
    if (!joinedIntent.current || !ownId || !fromConnectionId) return;
    const participant = participantsRef.current.find((candidate) => candidate.connectionId === fromConnectionId) ?? {
      connectionId: fromConnectionId,
      id: actor.id,
      label: actor.label,
      mode: "muted" as const,
    };
    const peer = ensurePeer(participant);
    if (!peer) return;
    void (async () => {
      try {
        if (signal.description) {
          const collision = signal.description.type === "offer" && (peer.makingOffer || peer.connection.signalingState !== "stable");
          const polite = ownId.localeCompare(fromConnectionId) > 0;
          peer.ignoreOffer = !polite && collision;
          if (peer.ignoreOffer) return;
          await peer.connection.setRemoteDescription(signal.description);
          for (const candidate of peer.candidates.splice(0)) await peer.connection.addIceCandidate(candidate);
          if (signal.description.type === "offer") {
            await peer.connection.setLocalDescription(await peer.connection.createAnswer());
            if (peer.connection.localDescription) sendSignal(fromConnectionId, { description: serializedDescription(peer.connection.localDescription) });
          }
        } else if (signal.candidate) {
          if (!peer.connection.remoteDescription) peer.candidates.push(signal.candidate);
          else await peer.connection.addIceCandidate(signal.candidate);
        }
      } catch {
        if (!peer.ignoreOffer) setError("A teammate's voice connection could not be completed.");
      }
    })();
  }, [ensurePeer, sendSignal]);

  const join = useCallback(async () => {
    setError(undefined);
    if (typeof RTCPeerConnection === "undefined") {
      setStatus("error");
      setError("This browser does not support WebRTC voice chat.");
      return;
    }
    joinedIntent.current = true;
    setStatus("joining");
    if (modeRef.current !== "muted") {
      try {
        await ensureMicrophone();
      } catch (caught) {
        setError(voiceErrorMessage(caught));
        modeRef.current = "muted";
        onModeChangeRef.current("muted");
      }
    }
    if (socketReady.current) sendRef.current({ type: "voice-join", mode: modeRef.current });
  }, [ensureMicrophone]);

  const leave = useCallback(() => {
    if (socketReady.current && joinedIntent.current) sendRef.current({ type: "voice-leave" });
    joinedIntent.current = false;
    connected.current = false;
    talkingRef.current = false;
    setTalking(false);
    setStatus("idle");
    participantsRef.current = [];
    setParticipants([]);
    closePeers();
    stopMicrophone();
  }, [closePeers, stopMicrophone]);

  const handleDisconnected = useCallback(() => {
    socketReady.current = false;
    ownConnectionId.current = undefined;
    connected.current = false;
    updateLocalTrack();
    closePeers();
    participantsRef.current = [];
    setParticipants([]);
    setStatus(joinedIntent.current ? "joining" : "idle");
  }, [closePeers, updateLocalTrack]);

  const handleError = useCallback((message: string) => {
    joinedIntent.current = false;
    connected.current = false;
    talkingRef.current = false;
    setTalking(false);
    setStatus("error");
    setError(message || "Voice chat is unavailable.");
    participantsRef.current = [];
    setParticipants([]);
    closePeers();
    stopMicrophone();
  }, [closePeers, stopMicrophone]);

  const startTalking = useCallback(() => {
    if (modeRef.current !== "push-to-talk" || !connected.current) return;
    talkingRef.current = true;
    setTalking(true);
    updateLocalTrack();
  }, [updateLocalTrack]);

  const stopTalking = useCallback(() => {
    if (!talkingRef.current) return;
    talkingRef.current = false;
    setTalking(false);
    updateLocalTrack();
  }, [updateLocalTrack]);

  useEffect(() => {
    if (!joinedIntent.current || !socketReady.current) return;
    const updateMode = async () => {
      if (mode !== "muted") {
        try {
          await ensureMicrophone();
        } catch (caught) {
          setError(voiceErrorMessage(caught));
          modeRef.current = "muted";
          onModeChangeRef.current("muted");
          sendRef.current({ type: "voice-mode", mode: "muted" });
          updateLocalTrack();
          return;
        }
      }
      sendRef.current({ type: "voice-mode", mode });
      updateLocalTrack();
    };
    void updateMode();
  }, [ensureMicrophone, mode, updateLocalTrack]);

  useEffect(() => () => {
    joinedIntent.current = false;
    connected.current = false;
    closePeers();
    stopMicrophone();
  }, [closePeers, sessionId, stopMicrophone]);

  return { status, participants, error, talking, audioRef, join, leave, resumeAudio, startTalking, stopTalking, handleReady, handlePresence, handleConfig, handleSignal, handleError, handleDisconnected };
}
