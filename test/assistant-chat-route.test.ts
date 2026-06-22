import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dynamic,
  handleAssistantChatRequest,
  runtime,
} from "../app/api/assistant/chat/route.ts";
import type { AssistantStreamEvent } from "../core/product/assistant/types.ts";
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

function chatRequest(body: unknown): Request {
  return new Request("https://bombsell.test/api/assistant/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("assistant chat route streams the expected SSE event names", async () => {
  async function* stubEvents(): AsyncIterable<AssistantStreamEvent> {
    yield { type: "text-delta", text: "Hello" };
    yield {
      type: "card",
      card: {
        id: "card_1",
        kind: "summary",
        tone: "default",
        title: "Reply rate",
        body: "Reply rate for 7d.",
      },
    };
    yield {
      type: "confirmation",
      confirmation: {
        token: "token",
        title: "Dispatch outreach workflows?",
        body: "Needs confirmation.",
        confirm_label: "Dispatch outreach",
        cancel_label: "Cancel",
      },
      card: {
        id: "confirm_1",
        kind: "confirmation",
        tone: "warning",
        title: "Dispatch outreach workflows?",
        body: "Needs confirmation.",
      },
      call_id: "call_1",
    };
    yield { type: "done", finish_reason: "stop" };
  }

  const response = await handleAssistantChatRequest(chatRequest({
    message: "hello",
  }), {
    getSession: async () => activeSession(),
    assertSessionAllowed: async () => {},
    assertToolAllowed: async () => {},
    streamAssistant: stubEvents as typeof import("../core/product/assistant/orchestrator.ts").streamAssistantResponse,
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const body = await response.text();
  assert.match(body, /event: text-delta/);
  assert.match(body, /event: card/);
  assert.match(body, /event: confirmation/);
  assert.match(body, /event: done/);
  assert.match(body, /"call_id":"call_1"/);
});

test("assistant chat route runs as a dynamic node handler", () => {
  assert.equal(dynamic, "force-dynamic");
  assert.equal(runtime, "nodejs");
});
