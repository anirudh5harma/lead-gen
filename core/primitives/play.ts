import { z } from "zod";
import { ChannelAutonomy } from "./rep";

/**
 * Play — a reusable, parameterized workflow. Authored in natural language;
 * compiled into a Step DAG that the durable runtime executes. One of the
 * five primitives. See ARCHITECTURE.md and db/migrations/009_primitive_play.sql.
 */

export const PlayStatus = z.enum(["draft", "active", "paused", "archived"]);
export type PlayStatus = z.infer<typeof PlayStatus>;

export const PlayRunStatus = z.enum([
  "pending",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
]);
export type PlayRunStatus = z.infer<typeof PlayRunStatus>;

/**
 * Autonomy on a Play: per-channel volume + approval policy plus global caps.
 * Evaluated at every channel.send() call inside the workflow.
 */
export const PlayAutonomy = z.object({
  channels: z.record(z.string(), ChannelAutonomy).default({}),
  global: z
    .object({
      max_concurrent_conversations: z.number().int().positive().optional(),
      daily_cap_across_channels: z.number().int().nonnegative().optional(),
    })
    .default({}),
});
export type PlayAutonomy = z.infer<typeof PlayAutonomy>;

/**
 * Trigger declaration: when does this Play wake up?
 *
 *  - `signal`   : a signal matching `filter` lands.
 *  - `event`    : a typed event of `event_type` is published.
 *  - `schedule` : a cron-like recurring fire (kept narrow — most things should
 *                 be event-driven).
 *  - `manual`   : user dispatches by hand.
 */
export const PlayTrigger = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("signal"),
    filter: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({
    kind: z.literal("event"),
    event_type: z.string(),
    filter: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({
    kind: z.literal("schedule"),
    cron: z.string(),
  }),
  z.object({
    kind: z.literal("manual"),
  }),
]);
export type PlayTrigger = z.infer<typeof PlayTrigger>;

/**
 * A compiled step in a Play's workflow spec. Concrete step types are defined
 * by their `op` (e.g. 'research.person', 'draft.email', 'send.email',
 * 'approval.gate', 'wait.for_event'). The shape of `params` is op-specific
 * and validated by the registry in core/plays/ops/.
 */
export const PlayStep = z.object({
  id: z.string(),
  op: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  on_failure: z
    .enum(["fail", "skip", "compensate", "retry"])
    .default("retry"),
  retry: z
    .object({
      max_attempts: z.number().int().positive().default(3),
      backoff: z.enum(["fixed", "exponential"]).default("exponential"),
    })
    .default({ max_attempts: 3, backoff: "exponential" }),
});
export type PlayStep = z.infer<typeof PlayStep>;

export const PlaySpec = z.object({
  trigger: PlayTrigger,
  steps: z.array(PlayStep).min(1),
  branches: z.record(z.string(), z.array(z.string())).default({}),
});
export type PlaySpec = z.infer<typeof PlaySpec>;

export const Play = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  declaration: z.string().min(1),
  compiled: PlaySpec,
  compiler_version: z.string().nullable(),
  autonomy: PlayAutonomy,
  default_rep_id: z.string().uuid().nullable(),
  status: PlayStatus,
  version: z.number().int().positive(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Play = z.infer<typeof Play>;
