import { verifyConfirmationToken } from "./policy.ts";
import { presentErrorCard } from "./presenters.ts";
import { executeAssistantTool } from "./tool-surface.ts";
import type { AssistantToolRequest, AssistantToolRouteResponse } from "./types.ts";

export async function handleAssistantToolRequest(input: {
  body: AssistantToolRequest;
  userId: string;
  workspaceId: string;
}): Promise<AssistantToolRouteResponse> {
  if (input.body.action === "confirm") {
    let payload;
    try {
      payload = verifyConfirmationToken(input.body.confirmation_token, {
        userId: input.userId,
        workspaceId: input.workspaceId,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Confirmation request failed.";
      return {
        status: "errored",
        tool_name: "confirmation",
        cards: presentErrorCard("confirmation", message),
        error: message,
      };
    }
    return executeAssistantTool({
      toolName: payload.tool_name,
      arguments: payload.input,
      confirmed: true,
      ctx: {
        workspace_id: input.workspaceId,
        user_id: input.userId,
      },
    });
  }

  return executeAssistantTool({
    toolName: input.body.tool_name,
    arguments: input.body.arguments,
    callId: input.body.call_id ?? null,
    requestId: input.body.request_id ?? null,
    ctx: {
      workspace_id: input.workspaceId,
      user_id: input.userId,
    },
  });
}
