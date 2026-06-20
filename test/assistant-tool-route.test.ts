import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dynamic,
  handleAssistantToolRequest,
  runtime,
} from "../app/api/assistant/tool/route.ts";
import { AssistantUsageCapExceededError } from "../core/product/assistant/telemetry.ts";
import type { AssistantToolRequest } from "../core/product/assistant/types.ts";
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

function toolRequest(body: AssistantToolRequest | Record<string, unknown>): Request {
  return new Request("https://bombsell.test/api/assistant/tool", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("assistant tool route requires authentication", async () => {
  const response = await handleAssistantToolRequest(toolRequest({
    action: "invoke",
    tool_name: "get_brief",
    arguments: {},
  }), {
    getSession: async () => null,
  });

  assert.equal(response.status, 401);
  assert.match(await response.text(), /Authentication required/);
});

test("assistant tool route validates the request body", async () => {
  const response = await handleAssistantToolRequest(toolRequest({
    action: "invoke",
    arguments: {},
  }), {
    getSession: async () => activeSession(),
  });

  assert.equal(response.status, 400);
  assert.match(await response.text(), /Valid assistant tool request required/);
});

test("assistant tool route rejects assistant arguments outside the drawer contract", async () => {
  let called = false;
  const response = await handleAssistantToolRequest(toolRequest({
    action: "invoke",
    tool_name: "dispatch_outreach",
    arguments: { limit: 26 },
  }), {
    getSession: async () => activeSession(),
    assertToolAllowed: async () => {},
    runToolRequest: async () => {
      called = true;
      throw new Error("should not run");
    },
  });

  assert.equal(response.status, 400);
  assert.match(await response.text(), /Invalid arguments for dispatch_outreach/i);
  assert.equal(called, false);
});

test("assistant tool route returns completed tool results and telemetry", async () => {
  let seenTelemetry:
    | {
        workspaceId: string;
        userId: string;
        toolName: string;
        callId?: string | null;
        requestId?: string | null;
        status: "completed" | "confirmation_pending" | "errored";
        requiresConfirmation: boolean;
        latencyMs: number;
      }
    | null = null;

  const response = await handleAssistantToolRequest(toolRequest({
    action: "invoke",
    tool_name: "get_brief",
    call_id: "call_123",
    request_id: "req_123",
    arguments: {},
  }), {
    getSession: async () => activeSession(),
    assertToolAllowed: async () => {},
    runToolRequest: async () => ({
      status: "completed",
      tool_name: "get_brief",
      tool_output: {
        status: "completed",
        tool_name: "get_brief",
        result: { ok: true },
      },
      cards: [],
    }),
    publishToolCalled: async (input) => {
      seenTelemetry = input;
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "completed",
    tool_name: "get_brief",
    tool_output: {
      status: "completed",
      tool_name: "get_brief",
      result: { ok: true },
    },
    cards: [],
  });
  assert.ok(seenTelemetry);
  assert.equal(seenTelemetry.workspaceId, WORKSPACE_ID);
  assert.equal(seenTelemetry.userId, USER_ID);
  assert.equal(seenTelemetry.toolName, "get_brief");
  assert.equal(seenTelemetry.callId, "call_123");
  assert.equal(seenTelemetry.requestId, "req_123");
  assert.equal(seenTelemetry.status, "completed");
  assert.equal(seenTelemetry.requiresConfirmation, false);
  assert.equal(typeof seenTelemetry.latencyMs, "number");
});

test("assistant tool route returns 202 for confirmation boundaries", async () => {
  const response = await handleAssistantToolRequest(toolRequest({
    action: "invoke",
    tool_name: "dispatch_outreach",
    arguments: { limit: 3 },
  }), {
    getSession: async () => activeSession(),
    assertToolAllowed: async () => {},
    publishToolCalled: async () => {},
    runToolRequest: async () => ({
      status: "requires_confirmation",
      tool_name: "dispatch_outreach",
      cards: [],
      confirmation: {
        token: "token",
        title: "Dispatch outreach workflows?",
        body: "Needs confirmation.",
        confirm_label: "Dispatch outreach",
        cancel_label: "Cancel",
      },
    }),
  });

  assert.equal(response.status, 202);
  assert.equal(
    (await response.json() as { status: string }).status,
    "requires_confirmation",
  );
});

test("assistant tool route returns handled confirmation failures as 422", async () => {
  const response = await handleAssistantToolRequest(toolRequest({
    action: "confirm",
    confirmation_token: "invalid",
  }), {
    getSession: async () => activeSession(),
    assertToolAllowed: async () => {},
    publishToolCalled: async () => {},
    runToolRequest: async () => ({
      status: "errored",
      tool_name: "confirmation",
      cards: [],
      error: "Invalid confirmation token.",
    }),
  });

  assert.equal(response.status, 422);
  assert.equal(
    (await response.json() as { error?: string; status: string }).status,
    "errored",
  );
});

test("assistant tool route reports unexpected failures as 500 and emits telemetry", async () => {
  let seenStatus: string | null = null;
  const originalError = console.error;
  console.error = () => {};

  try {
    const response = await handleAssistantToolRequest(toolRequest({
    action: "invoke",
    tool_name: "get_brief",
    arguments: {},
  }), {
    getSession: async () => activeSession(),
    assertToolAllowed: async () => {},
    runToolRequest: async () => {
      throw new Error("tool exploded");
    },
      publishToolCalled: async (input) => {
        seenStatus = input.status;
      },
    });

    assert.equal(response.status, 500);
    assert.match(await response.text(), /tool exploded/);
    assert.equal(seenStatus, "errored");
  } finally {
    console.error = originalError;
  }
});

test("assistant tool route enforces the workspace tool-call cap", async () => {
  const response = await handleAssistantToolRequest(toolRequest({
    action: "invoke",
    tool_name: "get_brief",
    arguments: {},
  }), {
    getSession: async () => activeSession(),
    assertToolAllowed: async () => {
      throw new AssistantUsageCapExceededError({
        kind: "tool",
        cap: 10,
        used: 10,
      });
    },
  });

  assert.equal(response.status, 429);
  assert.match(await response.text(), /tool call cap reached/i);
});

test("assistant tool route runs as a dynamic node handler", () => {
  assert.equal(dynamic, "force-dynamic");
  assert.equal(runtime, "nodejs");
});
