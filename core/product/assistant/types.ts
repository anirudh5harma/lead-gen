import { z } from "zod";

export const AssistantSessionModeSchema = z.enum(["text", "voice"]);
export type AssistantSessionMode = z.infer<typeof AssistantSessionModeSchema>;
export const ASSISTANT_TOOL_NAMES = [
  "get_brief",
  "get_launch_readiness",
  "list_qualified_signals",
  "get_workspace_context",
  "recall_company_brain",
  "get_conversation_proof",
  "generate_meeting_prep",
  "update_icp",
  "decide_approval",
  "dispatch_outreach",
  "retry_failed_workflow",
] as const;
export const AssistantToolNameSchema = z.enum(ASSISTANT_TOOL_NAMES);
export type AssistantToolName = z.infer<typeof AssistantToolNameSchema>;

export interface AssistantCardMetric {
  label: string;
  value: string;
}

export interface AssistantCardAction {
  label: string;
  href?: string;
  variant?: "solid" | "quiet";
}

export interface AssistantCard {
  id: string;
  kind: "summary" | "confirmation" | "status";
  tone: "default" | "success" | "warning" | "error";
  title: string;
  body: string;
  metrics?: AssistantCardMetric[];
  actions?: AssistantCardAction[];
}

export interface AssistantRealtimeFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AssistantConfirmationRequest {
  token: string;
  title: string;
  body: string;
  confirm_label: string;
  cancel_label: string;
}

export interface AssistantToolRouteResponse {
  status: "completed" | "requires_confirmation" | "errored";
  tool_name: string;
  tool_output?: Record<string, unknown>;
  cards: AssistantCard[];
  confirmation?: AssistantConfirmationRequest;
  error?: string;
}

export const AssistantSessionRequestSchema = z.object({
  sdp: z.string().min(1).max(200_000),
  mode: AssistantSessionModeSchema.default("voice"),
});
export type AssistantSessionRequest = z.infer<
  typeof AssistantSessionRequestSchema
>;

export const AssistantSessionResponseSchema = z.object({
  ok: z.literal(true),
  sdp: z.string().min(1),
  mode: AssistantSessionModeSchema,
  call_id: z.string().nullable(),
});
export type AssistantSessionResponse = z.infer<
  typeof AssistantSessionResponseSchema
>;

export const AssistantChatHistoryTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(20_000),
});
export type AssistantChatHistoryTurn = z.infer<
  typeof AssistantChatHistoryTurnSchema
>;

export const AssistantChatRequestSchema = z.object({
  message: z.string().min(1).max(20_000),
  history: z.array(AssistantChatHistoryTurnSchema).max(50).optional(),
});
export type AssistantChatRequest = z.infer<typeof AssistantChatRequestSchema>;

const AssistantCallIdSchema = z.string().min(1).max(256);
const AssistantRequestIdSchema = z.string().min(1).max(256);

export const AssistantToolInvokeRequestSchema = z.object({
  action: z.literal("invoke"),
  tool_name: AssistantToolNameSchema,
  call_id: AssistantCallIdSchema.nullable().optional(),
  arguments: z.record(z.string().max(64), z.unknown()).default({}),
  request_id: AssistantRequestIdSchema.nullable().optional(),
});
export type AssistantToolInvokeRequest = z.infer<
  typeof AssistantToolInvokeRequestSchema
>;

export const AssistantToolConfirmRequestSchema = z.object({
  action: z.literal("confirm"),
  confirmation_token: z.string().min(1).max(4096),
});
export type AssistantToolConfirmRequest = z.infer<
  typeof AssistantToolConfirmRequestSchema
>;

export const AssistantToolRequestSchema = z.discriminatedUnion("action", [
  AssistantToolInvokeRequestSchema,
  AssistantToolConfirmRequestSchema,
]);
export type AssistantToolRequest = z.infer<typeof AssistantToolRequestSchema>;

export interface AssistantTextDeltaEvent {
  type: "text-delta";
  text: string;
}

export interface AssistantCardEvent {
  type: "card";
  card: AssistantCard;
}

export interface AssistantConfirmationEvent {
  type: "confirmation";
  confirmation: AssistantConfirmationRequest;
  card: AssistantCard;
  call_id: string;
}

export interface AssistantDoneEvent {
  type: "done";
  finish_reason: "stop";
}

export interface AssistantErrorEvent {
  type: "error";
  error: string;
}

export type AssistantStreamEvent =
  | AssistantTextDeltaEvent
  | AssistantCardEvent
  | AssistantConfirmationEvent
  | AssistantDoneEvent
  | AssistantErrorEvent;
