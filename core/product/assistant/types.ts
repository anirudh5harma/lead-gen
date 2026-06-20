import { z } from "zod";

export const AssistantSessionModeSchema = z.enum(["text", "voice"]);
export type AssistantSessionMode = z.infer<typeof AssistantSessionModeSchema>;

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
  sdp: z.string().min(1),
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

export const AssistantToolInvokeRequestSchema = z.object({
  action: z.literal("invoke"),
  tool_name: z.string().min(1),
  call_id: z.string().nullable().optional(),
  arguments: z.record(z.string(), z.unknown()).default({}),
  request_id: z.string().nullable().optional(),
});
export type AssistantToolInvokeRequest = z.infer<
  typeof AssistantToolInvokeRequestSchema
>;

export const AssistantToolConfirmRequestSchema = z.object({
  action: z.literal("confirm"),
  confirmation_token: z.string().min(1),
});
export type AssistantToolConfirmRequest = z.infer<
  typeof AssistantToolConfirmRequestSchema
>;

export const AssistantToolRequestSchema = z.discriminatedUnion("action", [
  AssistantToolInvokeRequestSchema,
  AssistantToolConfirmRequestSchema,
]);
export type AssistantToolRequest = z.infer<typeof AssistantToolRequestSchema>;

