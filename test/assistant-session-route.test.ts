import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dynamic,
  handleAssistantSessionRequest,
  runtime,
} from "../app/api/assistant/session/route.ts";
import { AssistantUsageCapExceededError } from "../core/product/assistant/telemetry.ts";
import type { ActiveWorkspaceSession } from "../lib/workspace.ts";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function activeSession(): ActiveWorkspaceSession {
  return {
    workspace: {
      id: WORKSPACE_ID,
      slug: "demo",
      name: "Demo",
    },
    user_id: USER_ID,
    role: "owner",
  };
}

function sessionRequest(body: unknown): Request {
  return new Request("https://bombsell.test/api/assistant/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("assistant session route requires authentication", async () => {
  const response = await handleAssistantSessionRequest(sessionRequest({
    sdp: "offer-sdp",
    mode: "voice",
  }), {
    getSession: async () => null,
  });

  assert.equal(response.status, 401);
  assert.match(await response.text(), /Authentication required/);
});

test("assistant session route validates the request body", async () => {
  const response = await handleAssistantSessionRequest(sessionRequest({
    mode: "voice",
  }), {
    getSession: async () => activeSession(),
    assertSessionAllowed: async () => {},
  });

  assert.equal(response.status, 400);
  assert.match(await response.text(), /Valid sdp and mode are required/);
});

test("assistant session route starts realtime and records telemetry", async () => {
  let seenRealtime:
    | { mode: "text" | "voice"; sdp: string; userId: string }
    | null = null;
  let seenTelemetry:
    | {
        workspaceId: string;
        userId: string;
        mode: "text" | "voice";
        callId: string | null;
        voice: string;
      }
    | null = null;

  const response = await handleAssistantSessionRequest(sessionRequest({
    sdp: "offer-sdp",
    mode: "voice",
  }), {
    getSession: async () => activeSession(),
    assertSessionAllowed: async () => {},
    startRealtime: async (input) => {
      seenRealtime = input;
      return { sdp: "answer-sdp", callId: "call_123" };
    },
    publishStarted: async (input) => {
      seenTelemetry = input;
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    sdp: "answer-sdp",
    mode: "voice",
    call_id: "call_123",
  });
  assert.deepEqual(seenRealtime, {
    sdp: "offer-sdp",
    mode: "voice",
    userId: USER_ID,
  });
  assert.deepEqual(seenTelemetry, {
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    mode: "voice",
    callId: "call_123",
    voice: "marin",
  });
});

test("assistant session route surfaces realtime startup failures", async () => {
  const originalError = console.error;
  console.error = () => {};

  try {
    const response = await handleAssistantSessionRequest(sessionRequest({
    sdp: "offer-sdp",
    mode: "text",
  }), {
    getSession: async () => activeSession(),
    assertSessionAllowed: async () => {},
    startRealtime: async () => {
      throw new Error("OpenAI unavailable");
    },
    });

    assert.equal(response.status, 503);
    assert.match(await response.text(), /OpenAI unavailable/);
  } finally {
    console.error = originalError;
  }
});

test("assistant session route enforces the workspace session cap", async () => {
  const response = await handleAssistantSessionRequest(sessionRequest({
    sdp: "offer-sdp",
    mode: "voice",
  }), {
    getSession: async () => activeSession(),
    assertSessionAllowed: async () => {
      throw new AssistantUsageCapExceededError({
        kind: "session",
        cap: 3,
        used: 3,
      });
    },
  });

  assert.equal(response.status, 429);
  assert.match(await response.text(), /session cap reached/i);
});

test("assistant session route runs as a dynamic node handler", () => {
  assert.equal(dynamic, "force-dynamic");
  assert.equal(runtime, "nodejs");
});
