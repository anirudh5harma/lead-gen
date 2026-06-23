import { z } from "zod";
import type { ToolContext } from "../../agents/tools/types.ts";
import { invokeTool } from "../../agents/tools/registry.ts";
import type { JsonSchemaObject, ToolSpec } from "../../agents/llm/types.ts";
import { registerGraphTools } from "../../graph/index.ts";
import { getPool } from "../../substrate/storage/index.ts";
import { registerProductTools } from "../tools.ts";
import {
  assistantConfirmationTools,
  validateAssistantToolInvocation,
} from "./tool-surface.ts";

const AssistantMetricNameSchema = z.enum([
  "reply_rate",
  "companies_targeted",
  "signals_qualified",
  "meetings_booked",
  "outreach_sent",
]);

const AssistantMetricWindowSchema = z.enum(["today", "7d", "30d", "all"]);

const AssistantEntityTypeSchema = z.enum(["company", "person", "source"]);

const AssistantUuidSchema = z.string().uuid();

const MetricsGetInputSchema = z.object({
  metric: AssistantMetricNameSchema,
  window: AssistantMetricWindowSchema,
}).strict();

const EntitiesFindInputSchema = z.object({
  entity_type: AssistantEntityTypeSchema,
  name: z.string().trim().min(1).max(500).optional(),
  domain: z.string().trim().min(1).max(255).optional(),
  email: z.string().email().optional(),
  linkedin_url: z.string().url().optional(),
  company_id: AssistantUuidSchema.optional(),
  kind: z.enum([
    "gdelt",
    "hn",
    "product_hunt",
    "rss",
    "job_board",
    "web_monitor",
    "podcast",
    "newsletter",
    "manual",
    "other",
  ]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).strict().superRefine((input, ctx) => {
  if (input.entity_type === "company" && !input.name && !input.domain) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "company lookups require name or domain",
      path: ["entity_type"],
    });
  }

  if (
    input.entity_type === "person" &&
    !input.email &&
    !input.linkedin_url &&
    !input.company_id
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "person lookups require email, linkedin_url, or company_id",
      path: ["entity_type"],
    });
  }
});

const EntitiesGetInputSchema = z.object({
  entity_type: AssistantEntityTypeSchema,
  id: AssistantUuidSchema,
}).strict();

const SignalsListInputSchema = z.object({
  limit: z.number().int().min(1).max(25).optional(),
}).strict();

const ConversationProofInputSchema = z.object({
  conversation_id: AssistantUuidSchema,
}).strict();

const MeetingPrepInputSchema = z.object({
  conversation_id: AssistantUuidSchema,
}).strict();

const EmptyInputSchema = z.object({}).strict();

export interface AssistantQueryToolDefinition {
  description: string;
  inputSchema: z.ZodType<Record<string, unknown>>;
  name: string;
  parameters: JsonSchemaObject;
  requiresConfirmation?: boolean;
  execute?: (
    input: Record<string, unknown>,
    ctx: ToolContext & { user_id: string },
  ) => Promise<Record<string, unknown>>;
}

function toolSpec(def: AssistantQueryToolDefinition): ToolSpec {
  return {
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  };
}

function ensureAssistantToolRegistry(): void {
  registerGraphTools();
  registerProductTools();
}

function windowPredicate(column: string, window: z.infer<typeof AssistantMetricWindowSchema>): string {
  if (window === "today") {
    return `${column} >= date_trunc('day', now())`;
  }
  if (window === "7d") {
    return `${column} >= now() - interval '7 days'`;
  }
  if (window === "30d") {
    return `${column} >= now() - interval '30 days'`;
  }
  return "true";
}

async function aggregateMetric(
  metric: z.infer<typeof AssistantMetricNameSchema>,
  window: z.infer<typeof AssistantMetricWindowSchema>,
  workspaceId: string,
): Promise<Record<string, unknown>> {
  const pool = getPool();

  if (metric === "reply_rate") {
    const sentFilter = windowPredicate("coalesce(m.sent_at, m.created_at)", window);
    const replyFilter = windowPredicate("coalesce(o.recorded_at, o.occurred_at)", window);
    const result = await pool.query<{
      replies: string;
      sent: string;
    }>(
      `select
         (select count(*)::text
            from outcomes o
           where o.workspace_id = $1
             and o.kind = 'positive_reply'
             and ${replyFilter}) as replies,
         (select count(*)::text
            from messages m
           where m.workspace_id = $1
             and m.direction = 'outbound'
             and m.channel in ('email', 'linkedin_dm', 'linkedin_inmail')
             and m.status in ('sent', 'delivered', 'replied')
             and ${sentFilter}) as sent`,
      [workspaceId],
    );
    const replies = Number(result.rows[0]?.replies ?? 0);
    const sent = Number(result.rows[0]?.sent ?? 0);
    return {
      metric,
      window,
      value: sent > 0 ? replies / sent : 0,
      unit: "ratio",
      numerator: replies,
      denominator: sent,
      label: "Reply rate",
      source_tools: ["assistant.metrics.aggregate"],
    };
  }

  if (metric === "companies_targeted") {
    const messageFilter = windowPredicate("coalesce(m.sent_at, m.created_at)", window);
    const result = await pool.query<{ companies_targeted: string }>(
      `select count(distinct coalesce(c.counterparty_company_id, s.related_company_id))::text as companies_targeted
         from messages m
         join conversations c
           on c.workspace_id = m.workspace_id
          and c.id = m.conversation_id
         left join signals s
           on s.workspace_id = c.workspace_id
          and s.id = c.origin_signal_id
        where m.workspace_id = $1
          and m.direction = 'outbound'
          and m.channel in ('email', 'linkedin_dm', 'linkedin_inmail')
          and m.status in ('sent', 'delivered', 'replied')
          and ${messageFilter}
          and coalesce(c.counterparty_company_id, s.related_company_id) is not null`,
      [workspaceId],
    );
    return {
      metric,
      window,
      value: Number(result.rows[0]?.companies_targeted ?? 0),
      unit: "count",
      label: "Companies targeted",
      source_tools: ["assistant.metrics.aggregate"],
    };
  }

  if (metric === "signals_qualified") {
    const signalFilter = windowPredicate("coalesce(s.ingested_at, s.freshness_at)", window);
    const result = await pool.query<{ signals_qualified: string }>(
      `select count(*)::text as signals_qualified
         from signals s
        where s.workspace_id = $1
          and s.status in ('matched', 'in_play')
          and ${signalFilter}`,
      [workspaceId],
    );
    return {
      metric,
      window,
      value: Number(result.rows[0]?.signals_qualified ?? 0),
      unit: "count",
      label: "Qualified signals",
      source_tools: ["assistant.metrics.aggregate"],
    };
  }

  if (metric === "meetings_booked") {
    const meetingFilter = windowPredicate("coalesce(o.recorded_at, o.occurred_at)", window);
    const result = await pool.query<{ meetings_booked: string }>(
      `select count(*)::text as meetings_booked
         from outcomes o
        where o.workspace_id = $1
          and o.kind = 'meeting_booked'
          and ${meetingFilter}`,
      [workspaceId],
    );
    return {
      metric,
      window,
      value: Number(result.rows[0]?.meetings_booked ?? 0),
      unit: "count",
      label: "Meetings booked",
      source_tools: ["assistant.metrics.aggregate"],
    };
  }

  const outreachFilter = windowPredicate("coalesce(m.sent_at, m.created_at)", window);
  const result = await pool.query<{ outreach_sent: string }>(
    `select count(*)::text as outreach_sent
       from messages m
      where m.workspace_id = $1
        and m.direction = 'outbound'
        and m.channel in ('email', 'linkedin_dm', 'linkedin_inmail')
        and m.status in ('sent', 'delivered', 'replied')
        and ${outreachFilter}`,
    [workspaceId],
  );
  return {
    metric,
    window,
    value: Number(result.rows[0]?.outreach_sent ?? 0),
    unit: "count",
    label: "Outreach sent",
    source_tools: ["assistant.metrics.aggregate"],
  };
}

async function readMetricFromBrief(
  metric: z.infer<typeof AssistantMetricNameSchema>,
  window: z.infer<typeof AssistantMetricWindowSchema>,
  ctx: ToolContext & { user_id: string },
): Promise<Record<string, unknown> | null> {
  if (!(window === "7d")) return null;
  ensureAssistantToolRegistry();
  const brief = await invokeTool<{
    windows: {
      last_7d: {
        qualified_signals: number;
        emails_sent: number;
        linkedin_dms_sent: number;
        replies: number;
        meetings: number;
      };
    };
  }>("product.brief.get", {}, ctx);
  const sent =
    Number(brief.windows.last_7d.emails_sent ?? 0) +
    Number(brief.windows.last_7d.linkedin_dms_sent ?? 0);
  const replies = Number(brief.windows.last_7d.replies ?? 0);

  if (metric === "reply_rate") {
    return {
      metric,
      window,
      value: sent > 0 ? replies / sent : 0,
      unit: "ratio",
      numerator: replies,
      denominator: sent,
      label: "Reply rate",
      source_tools: ["product.brief.get"],
    };
  }

  if (metric === "signals_qualified") {
    return {
      metric,
      window,
      value: Number(brief.windows.last_7d.qualified_signals ?? 0),
      unit: "count",
      label: "Qualified signals",
      source_tools: ["product.brief.get"],
    };
  }

  if (metric === "meetings_booked") {
    return {
      metric,
      window,
      value: Number(brief.windows.last_7d.meetings ?? 0),
      unit: "count",
      label: "Meetings booked",
      source_tools: ["product.brief.get"],
    };
  }

  if (metric === "outreach_sent") {
    return {
      metric,
      window,
      value: sent,
      unit: "count",
      label: "Outreach sent",
      source_tools: ["product.brief.get"],
    };
  }

  return null;
}

async function executeMetricsGet(
  input: Record<string, unknown>,
  ctx: ToolContext & { user_id: string },
): Promise<Record<string, unknown>> {
  const parsed = MetricsGetInputSchema.parse(input);
  const fromBrief = await readMetricFromBrief(parsed.metric, parsed.window, ctx);
  if (fromBrief) return fromBrief;
  return aggregateMetric(parsed.metric, parsed.window, ctx.workspace_id);
}

async function executeEntitiesFind(
  input: Record<string, unknown>,
  ctx: ToolContext & { user_id: string },
): Promise<Record<string, unknown>> {
  ensureAssistantToolRegistry();
  const parsed = EntitiesFindInputSchema.parse(input);

  if (parsed.entity_type === "company") {
    const items = await invokeTool<Array<Record<string, unknown>>>(
      "graph.companies.find",
      {
        ...(parsed.name ? { name: parsed.name } : {}),
        ...(parsed.domain ? { domain: parsed.domain } : {}),
        ...(parsed.limit ? { limit: parsed.limit } : {}),
      },
      ctx,
    );
    return { entity_type: "company", count: items.length, items };
  }

  if (parsed.entity_type === "person") {
    const items = await invokeTool<Array<Record<string, unknown>>>(
      "graph.persons.find",
      {
        ...(parsed.email ? { email: parsed.email } : {}),
        ...(parsed.linkedin_url ? { linkedin_url: parsed.linkedin_url } : {}),
        ...(parsed.company_id ? { company_id: parsed.company_id } : {}),
        ...(parsed.limit ? { limit: parsed.limit } : {}),
      },
      ctx,
    );
    return { entity_type: "person", count: items.length, items };
  }

  const items = await invokeTool<Array<Record<string, unknown>>>(
    "graph.sources.list",
    {
      ...(parsed.kind ? { kind: parsed.kind } : {}),
    },
    ctx,
  );
  return {
    entity_type: "source",
    count: items.length,
    items: parsed.limit ? items.slice(0, parsed.limit) : items,
  };
}

async function executeEntitiesGet(
  input: Record<string, unknown>,
  ctx: ToolContext & { user_id: string },
): Promise<Record<string, unknown>> {
  ensureAssistantToolRegistry();
  const parsed = EntitiesGetInputSchema.parse(input);

  if (parsed.entity_type === "company") {
    return {
      entity_type: "company",
      entity: await invokeTool<Record<string, unknown> | null>(
        "graph.companies.get",
        { id: parsed.id },
        ctx,
      ),
    };
  }

  if (parsed.entity_type === "person") {
    return {
      entity_type: "person",
      entity: await invokeTool<Record<string, unknown> | null>(
        "graph.persons.get",
        { id: parsed.id },
        ctx,
      ),
    };
  }

  return {
    entity_type: "source",
    entity: await invokeTool<Record<string, unknown> | null>(
      "graph.sources.get",
      { id: parsed.id },
      ctx,
    ),
  };
}

const READ_TOOL_DEFS: AssistantQueryToolDefinition[] = [
  {
    name: "metrics_get",
    description:
      "Read governed workspace metrics for reply rate, outreach volume, meetings, qualified signals, and companies targeted over a defined window.",
    inputSchema: MetricsGetInputSchema,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        metric: {
          type: "string",
          enum: AssistantMetricNameSchema.options,
          description: "The governed metric to read.",
        },
        window: {
          type: "string",
          enum: AssistantMetricWindowSchema.options,
          description: "Time window to scope the metric.",
        },
      },
      required: ["metric", "window"],
    },
    execute: executeMetricsGet,
  },
  {
    name: "entities_find",
    description:
      "Search read-only workspace graph entities: companies by name/domain, people by email/LinkedIn/company, or sources by kind.",
    inputSchema: EntitiesFindInputSchema,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        entity_type: {
          type: "string",
          enum: AssistantEntityTypeSchema.options,
        },
        name: { type: "string" },
        domain: { type: "string" },
        email: { type: "string" },
        linkedin_url: { type: "string" },
        company_id: { type: "string" },
        kind: {
          type: "string",
          enum: [
            "gdelt",
            "hn",
            "product_hunt",
            "rss",
            "job_board",
            "web_monitor",
            "podcast",
            "newsletter",
            "manual",
            "other",
          ],
        },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["entity_type"],
    },
    execute: executeEntitiesFind,
  },
  {
    name: "entities_get",
    description:
      "Fetch one company, person, or source from the workspace graph by id.",
    inputSchema: EntitiesGetInputSchema,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        entity_type: {
          type: "string",
          enum: AssistantEntityTypeSchema.options,
        },
        id: { type: "string" },
      },
      required: ["entity_type", "id"],
    },
    execute: executeEntitiesGet,
  },
  {
    name: "signals_list",
    description:
      "List qualified signals, verified contacts, and draft readiness from the current signal workbench.",
    inputSchema: SignalsListInputSchema,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 25 },
      },
    },
    async execute(input, ctx) {
      ensureAssistantToolRegistry();
      return invokeTool<Record<string, unknown>>(
        "product.qualified_signals.list",
        SignalsListInputSchema.parse(input),
        ctx,
      );
    },
  },
  {
    name: "conversation_proof",
    description:
      "Load the exact proof trace for one Conversation, including signal, drafts, replies, and meeting evidence.",
    inputSchema: ConversationProofInputSchema,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        conversation_id: { type: "string" },
      },
      required: ["conversation_id"],
    },
    async execute(input, ctx) {
      ensureAssistantToolRegistry();
      return invokeTool<Record<string, unknown>>(
        "product.conversation.trust.get",
        ConversationProofInputSchema.parse(input),
        ctx,
      );
    },
  },
  {
    name: "meeting_prep",
    description:
      "Generate source-backed meeting prep for one Conversation without dispatching outreach.",
    inputSchema: MeetingPrepInputSchema,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        conversation_id: { type: "string" },
      },
      required: ["conversation_id"],
    },
    async execute(input, ctx) {
      ensureAssistantToolRegistry();
      return invokeTool<Record<string, unknown>>(
        "product.meeting.prep.generate",
        MeetingPrepInputSchema.parse(input),
        ctx,
      );
    },
  },
  {
    name: "workspace_context",
    description:
      "Load prompt-ready workspace context across profile, signals, approvals, conversations, and outcomes.",
    inputSchema: EmptyInputSchema,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    async execute(_input, ctx) {
      ensureAssistantToolRegistry();
      return invokeTool<Record<string, unknown>>("product.context.get", {}, ctx);
    },
  },
  {
    name: "company_brain_recall",
    description:
      "Recall the shared company brain: profile facts, signals, outcomes, playbooks, and meeting prep memory.",
    inputSchema: EmptyInputSchema,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    async execute(_input, ctx) {
      ensureAssistantToolRegistry();
      return invokeTool<Record<string, unknown>>(
        "product.company_brain.recall",
        {},
        ctx,
      );
    },
  },
];

const WRITE_TOOL_DEFS: AssistantQueryToolDefinition[] = assistantConfirmationTools().map(
  (tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: z.object({}).passthrough(),
    parameters: tool.parameters as JsonSchemaObject,
    requiresConfirmation: true,
  }),
);

const ASSISTANT_QUERY_TOOL_DEFS = [...READ_TOOL_DEFS, ...WRITE_TOOL_DEFS];

function getAssistantQueryToolDefinition(name: string): AssistantQueryToolDefinition | undefined {
  return ASSISTANT_QUERY_TOOL_DEFS.find((tool) => tool.name === name);
}

function formatValidationError(name: string, error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return `Invalid arguments for ${name}.`;
  const path = issue.path.join(".");
  return path
    ? `Invalid arguments for ${name}: ${path} ${issue.message}.`
    : `Invalid arguments for ${name}: ${issue.message}.`;
}

export function assistantQueryToolSpecs(): ToolSpec[] {
  return ASSISTANT_QUERY_TOOL_DEFS.map(toolSpec);
}

export function validateAssistantQueryInvocation(input: {
  arguments: Record<string, unknown>;
  toolName: string;
}): {
  arguments: Record<string, unknown>;
  requiresConfirmation: boolean;
  toolName: string;
} {
  const def = getAssistantQueryToolDefinition(input.toolName);
  if (!def) {
    throw new Error("Unknown assistant tool.");
  }

  if (def.requiresConfirmation) {
    const validated = validateAssistantToolInvocation({
      toolName: input.toolName,
      arguments: input.arguments,
    });
    return {
      arguments: validated.arguments,
      requiresConfirmation: true,
      toolName: validated.toolName,
    };
  }

  const parsed = def.inputSchema.safeParse(input.arguments);
  if (!parsed.success) {
    throw new Error(formatValidationError(def.name, parsed.error));
  }
  return {
    arguments: parsed.data,
    requiresConfirmation: false,
    toolName: def.name,
  };
}

export async function dispatchAssistantQueryTool(input: {
  arguments: Record<string, unknown>;
  ctx: ToolContext & { user_id: string };
  toolName: string;
}): Promise<Record<string, unknown>> {
  const validated = validateAssistantQueryInvocation({
    toolName: input.toolName,
    arguments: input.arguments,
  });
  const def = getAssistantQueryToolDefinition(validated.toolName);
  if (!def) {
    throw new Error("Unknown assistant tool.");
  }
  if (validated.requiresConfirmation || !def.execute) {
    throw new Error(`Assistant tool ${validated.toolName} requires confirmation.`);
  }
  return def.execute(validated.arguments, input.ctx);
}

export function assistantToolRequiresConfirmation(toolName: string): boolean {
  return Boolean(getAssistantQueryToolDefinition(toolName)?.requiresConfirmation);
}

export function listAssistantQueryTools(): readonly AssistantQueryToolDefinition[] {
  return ASSISTANT_QUERY_TOOL_DEFS;
}
