"use client";

import type {
  AssistantSessionMode,
  AssistantSessionResponse,
} from "../../core/product/assistant/types.ts";

export interface AssistantReplayMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface AssistantRealtimeEvent {
  type: string;
  [key: string]: unknown;
}

export interface AssistantRealtimeConnection {
  callId: string | null;
  mode: AssistantSessionMode;
  close(): void;
  interrupt(): void;
  replayHistory(history: AssistantReplayMessage[]): void;
  requestResponse(options?: { textOnly?: boolean }): void;
  sendFunctionOutput(callId: string, output: unknown): void;
  sendText(input: { itemId: string; text: string }): void;
  setMicrophoneEnabled(enabled: boolean): void;
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

function parseRealtimeEvent(raw: string): AssistantRealtimeEvent | null {
  try {
    return JSON.parse(raw) as AssistantRealtimeEvent;
  } catch {
    return null;
  }
}

function replayContentType(role: "user" | "assistant") {
  return role === "assistant" ? "output_text" : "input_text";
}

function safeSend(channel: RTCDataChannel, event: Record<string, unknown>) {
  if (channel.readyState !== "open") {
    throw new Error("Assistant channel is not ready yet.");
  }
  channel.send(JSON.stringify(event));
}

export async function connectAssistantRealtime(input: {
  mode: AssistantSessionMode;
  onClose?: () => void;
  onEvent: (event: AssistantRealtimeEvent) => void;
}): Promise<AssistantRealtimeConnection> {
  const peer = new RTCPeerConnection();
  const dataChannel = peer.createDataChannel("oai-events");
  const audio = document.createElement("audio");
  audio.autoplay = true;
  audio.setAttribute("playsinline", "true");
  audio.style.display = "none";
  document.body.appendChild(audio);

  let localStream: MediaStream | null = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    dataChannel.close();
    peer.close();
    if (localStream) {
      for (const track of localStream.getTracks()) {
        track.stop();
      }
    }
    audio.pause();
    audio.srcObject = null;
    audio.remove();
    input.onClose?.();
  };

  dataChannel.addEventListener("message", (event) => {
    const parsed = parseRealtimeEvent(String(event.data ?? ""));
    if (parsed) input.onEvent(parsed);
  });
  dataChannel.addEventListener("close", () => {
    cleanup();
  });

  peer.addEventListener("track", (event) => {
    const [stream] = event.streams;
    audio.srcObject = stream ?? new MediaStream([event.track]);
    void audio.play().catch(() => {});
  });

  if (input.mode === "voice") {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    for (const track of localStream.getAudioTracks()) {
      track.enabled = false;
      peer.addTrack(track, localStream);
    }
  } else {
    peer.addTransceiver("audio", { direction: "recvonly" });
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
      body: JSON.stringify({
        mode: input.mode,
        sdp: offer.sdp,
      }),
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(assistantErrorMessage(detail));
    }

    const session =
      (await response.json()) as AssistantSessionResponse;

    await peer.setRemoteDescription({
      type: "answer",
      sdp: session.sdp,
    });
    await opened;

    return {
      callId: session.call_id,
      mode: input.mode,
      close: cleanup,
      interrupt() {
        safeSend(dataChannel, { type: "response.cancel" });
        safeSend(dataChannel, { type: "output_audio_buffer.clear" });
      },
      replayHistory(history) {
        for (const message of history) {
          safeSend(dataChannel, {
            type: "conversation.item.create",
            item: {
              id: message.id,
              type: "message",
              role: message.role,
              content: [
                {
                  type: replayContentType(message.role),
                  text: message.text,
                },
              ],
            },
          });
        }
      },
      requestResponse(options) {
        safeSend(dataChannel, {
          type: "response.create",
          ...(options?.textOnly
            ? { response: { output_modalities: ["text"] } }
            : {}),
        });
      },
      sendFunctionOutput(callId, output) {
        safeSend(dataChannel, {
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output:
              typeof output === "string" ? output : JSON.stringify(output),
          },
        });
      },
      sendText({ itemId, text }) {
        safeSend(dataChannel, {
          type: "conversation.item.create",
          item: {
            id: itemId,
            type: "message",
            role: "user",
            content: [{ type: "input_text", text }],
          },
        });
      },
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
