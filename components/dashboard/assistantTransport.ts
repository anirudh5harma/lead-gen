"use client";

import type { AssistantSessionResponse } from "../../core/product/assistant/types.ts";

/**
 * Voice capture transport. OpenAI Realtime is used here ONLY as a streaming
 * transcription service: the mic audio goes up over WebRTC and we consume the
 * input-audio transcription events. There is no model reasoning, no audio
 * output, and no function calling on this channel — reasoning runs
 * server-side behind /api/assistant/chat and replies as text in the drawer.
 */

export interface AssistantTranscriptionConnection {
  callId: string | null;
  close(): void;
  setMicrophoneEnabled(enabled: boolean): void;
}

interface RealtimeEvent {
  type?: string;
  transcript?: string;
  delta?: string;
  error?: { message?: string };
  [key: string]: unknown;
}

function assistantErrorMessage(detail: unknown): string {
  if (
    detail &&
    typeof detail === "object" &&
    "error" in detail &&
    typeof (detail as { error?: unknown }).error === "string"
  ) {
    return (detail as { error: string }).error;
  }
  return "Assistant connection failed.";
}

function parseRealtimeEvent(raw: string): RealtimeEvent | null {
  try {
    return JSON.parse(raw) as RealtimeEvent;
  } catch {
    return null;
  }
}

export async function connectAssistantTranscription(input: {
  /** Fired with the final transcript of each completed user utterance. */
  onTranscript: (text: string) => void;
  /** Optional interim transcript while the user is still speaking. */
  onPartial?: (text: string) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
}): Promise<AssistantTranscriptionConnection> {
  const peer = new RTCPeerConnection();
  const dataChannel = peer.createDataChannel("oai-events");

  let localStream: MediaStream | null = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    dataChannel.close();
    peer.close();
    if (localStream) {
      for (const track of localStream.getTracks()) track.stop();
    }
    input.onClose?.();
  };

  dataChannel.addEventListener("message", (event) => {
    const parsed = parseRealtimeEvent(String(event.data ?? ""));
    if (!parsed) return;

    if (
      parsed.type ===
        "conversation.item.input_audio_transcription.completed" &&
      typeof parsed.transcript === "string" &&
      parsed.transcript.trim().length > 0
    ) {
      input.onTranscript(parsed.transcript.trim());
      return;
    }
    if (
      parsed.type === "conversation.item.input_audio_transcription.delta" &&
      typeof parsed.delta === "string"
    ) {
      input.onPartial?.(parsed.delta);
      return;
    }
    if (parsed.type === "error") {
      input.onError?.(parsed.error?.message ?? "Transcription error.");
    }
  });
  dataChannel.addEventListener("close", cleanup);

  // Mic is the only media; we never receive remote audio in transcription mode.
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  for (const track of localStream.getAudioTracks()) {
    track.enabled = false; // hold-to-talk: enabled only while pressed
    peer.addTrack(track, localStream);
  }

  const opened = new Promise<void>((resolve, reject) => {
    dataChannel.addEventListener("open", () => resolve(), { once: true });
    dataChannel.addEventListener(
      "error",
      () => reject(new Error("Assistant data channel failed to open.")),
      { once: true },
    );
  });

  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    const response = await fetch("/api/assistant/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "voice", sdp: offer.sdp }),
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(assistantErrorMessage(detail));
    }

    const session = (await response.json()) as AssistantSessionResponse;
    await peer.setRemoteDescription({ type: "answer", sdp: session.sdp });
    await opened;

    return {
      callId: session.call_id,
      close: cleanup,
      setMicrophoneEnabled(enabled) {
        for (const track of localStream?.getAudioTracks() ?? []) {
          track.enabled = enabled;
        }
      },
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
