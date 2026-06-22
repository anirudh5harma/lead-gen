import { verifyConfirmationToken } from "./policy.ts";
import { presentErrorCard } from "./presenters.ts";
import { executeAssistantTool } from "./tool-surface.ts";
import type { AssistantToolRequest, AssistantToolRouteResponse } from "./types.ts";

export async function handleAssistantToolRequest(input: {
  body: AssistantToolRequest;
  userId: string;
  workspaceId: string;
}): Promise<AssistantToolRouteResponse> {
  if (input.body.action !== "confirm") {
    return {
      status: "errored",
      tool_name: input.body.tool_name,
      cards: presentErrorCard(
        input.body.tool_name,
        "Direct assistant tool invocation is not supported on this route.",
      ),
      error: "Direct assistant tool invocation is not supported on this route.",
    };
  }

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
