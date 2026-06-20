import { invokeTool } from "../../agents/tools/registry.ts";
import type { ToolContext } from "../../agents/tools/types.ts";
import { registerProductTools } from "../tools.ts";
import { createConfirmationToken, describeConfirmation, toolRequiresConfirmation } from "./policy.ts";
import { presentErrorCard, presentToolResult } from "./presenters.ts";
import type {
  AssistantRealtimeFunctionTool,
  AssistantToolRouteResponse,
} from "./types.ts";

type AssistantToolName =
  | "get_brief"
  | "get_launch_readiness"
  | "list_qualified_signals"
  | "get_workspace_context"
  | "recall_company_brain"
  | "get_conversation_proof"
  | "generate_meeting_prep"
  | "decide_approval"
  | "dispatch_outreach"
  | "retry_failed_workflow";

interface AssistantToolDefinition {
  description: string;
  name: AssistantToolName;
  parameters: Record<string, unknown>;
  productTool: string;
}

const TOOL_DEFS: Record<AssistantToolName, AssistantToolDefinition> = {
  get_brief: {
    name: "get_brief",
    description:
      "Get the current Bombsell operating brief: signal volume, outreach, replies, meetings, pending reviews, channel readiness, and next action.",
    productTool: "product.brief.get",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  get_launch_readiness: {
    name: "get_launch_readiness",
    description:
      "Check why outbound is ready, blocked, or needs attention for email or LinkedIn.",
    productTool: "product.launch.readiness.get",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        required_channel: {
          type: "string",
          enum: ["any", "email", "linkedin", "both"],
          description: "Optional channel scope to evaluate.",
        },
      },
    },
  },
  list_qualified_signals: {
    name: "list_qualified_signals",
    description:
      "List qualified signals, verified contacts, draft readiness, and approval blockers.",
    productTool: "product.qualified_signals.list",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 25,
          description: "Maximum number of qualified signals to inspect.",
        },
      },
    },
  },
  get_workspace_context: {
    name: "get_workspace_context",
    description:
      "Load deeper workspace context spanning profile, sources, approvals, conversations, and outcomes.",
    productTool: "product.context.get",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  recall_company_brain: {
    name: "recall_company_brain",
    description:
      "Recall shared company memory, decisions, signals, outcomes, and meeting prep.",
    productTool: "product.company_brain.recall",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  get_conversation_proof: {
    name: "get_conversation_proof",
    description:
      "Load the exact proof trace for one outreach conversation, including signal, drafts, replies, and meeting evidence.",
    productTool: "product.conversation.trust.get",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        conversation_id: {
          type: "string",
          description: "Conversation UUID from Bombsell outreach proof.",
        },
      },
      required: ["conversation_id"],
    },
  },
  generate_meeting_prep: {
    name: "generate_meeting_prep",
    description:
      "Generate source-backed meeting prep for one Bombsell conversation.",
    productTool: "product.meeting.prep.generate",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        conversation_id: {
          type: "string",
          description: "Conversation UUID for the meeting prep request.",
        },
      },
      required: ["conversation_id"],
    },
  },
  decide_approval: {
    name: "decide_approval",
    description:
      "Approve or reject a pending Bombsell approval gate after explicit confirmation.",
    productTool: "product.approval.decide",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        approval_id: {
          type: "string",
          description: "Pending approval UUID.",
        },
        decision: {
          type: "string",
          enum: ["approved", "rejected"],
          description: "Approval decision to record.",
        },
        note: {
          type: "string",
          description: "Optional short note explaining the decision.",
        },
      },
      required: ["approval_id", "decision"],
    },
  },
  dispatch_outreach: {
    name: "dispatch_outreach",
    description:
      "Dispatch durable outreach workflows for matched Bombsell signals after explicit confirmation.",
    productTool: "product.signals.dispatch_plays",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 25,
          description: "Optional cap on how many signals to dispatch.",
        },
      },
    },
  },
  retry_failed_workflow: {
    name: "retry_failed_workflow",
    description:
      "Retry a failed Bombsell workflow run after explicit confirmation.",
    productTool: "product.workflow.retry",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        run_id: {
          type: "string",
          description: "Failed workflow run UUID.",
        },
      },
      required: ["run_id"],
    },
  },
};

export function assistantRealtimeTools(): AssistantRealtimeFunctionTool[] {
  return Object.values(TOOL_DEFS).map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function getAssistantTool(
  toolName: string,
): AssistantToolDefinition | undefined {
  return TOOL_DEFS[toolName as AssistantToolName];
}

async function runProductTool(
  toolName: AssistantToolName,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  registerProductTools();
  const def = TOOL_DEFS[toolName];
  return invokeTool<Record<string, unknown>>(def.productTool, input, ctx);
}

export async function executeAssistantTool(input: {
  arguments: Record<string, unknown>;
  callId?: string | null;
  requestId?: string | null;
  toolName: string;
  ctx: ToolContext & { user_id: string };
  confirmed?: boolean;
}): Promise<AssistantToolRouteResponse> {
  const def = getAssistantTool(input.toolName);
  if (!def) {
    return {
      status: "errored",
      tool_name: input.toolName,
      cards: presentErrorCard(input.toolName, "Unknown assistant tool."),
      error: "Unknown assistant tool.",
    };
  }

  if (toolRequiresConfirmation(def.name) && !input.confirmed) {
    const description = describeConfirmation(def.name, input.arguments);
    const token = createConfirmationToken({
      toolName: def.name,
      input: input.arguments,
      userId: input.ctx.user_id,
      workspaceId: input.ctx.workspace_id,
    });
    return {
      status: "requires_confirmation",
      tool_name: def.name,
      tool_output: {
        status: "confirmation_pending",
        tool_name: def.name,
        message: description.body,
      },
      cards: [
        {
          id: `confirm:${def.name}`,
          kind: "confirmation",
          tone: "warning",
          title: description.title,
          body: description.body,
          actions: [
            {
              label: description.confirm_label,
              variant: "solid",
            },
          ],
        },
      ],
      confirmation: { token, ...description },
    };
  }

  try {
    const result = await runProductTool(def.name, input.arguments, input.ctx);
    return {
      status: "completed",
      tool_name: def.name,
      tool_output: {
        status: "completed",
        tool_name: def.name,
        result,
      },
      cards: presentToolResult(def.name, result),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "errored",
      tool_name: def.name,
      tool_output: {
        status: "errored",
        tool_name: def.name,
        error: message,
      },
      cards: presentErrorCard(def.name, message),
      error: message,
    };
  }
}
