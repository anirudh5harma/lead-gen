import { z } from "zod";

/**
 * Rep — the user-facing agent persona. See ARCHITECTURE.md "Five Primitives".
 * The Rep is the named identity (voice, role, KPIs, channels, autonomy).
 * Role-agent composition (researcher / writer / sender / replier) is a
 * runtime concern in core/agents/reps/ and not modelled here.
 *
 * Database: see db/migrations/008_primitive_rep.sql.
 */

export const RepRole = z.enum([
  "sdr",
  "content",
  "replier",
  "researcher",
  "campaign",
  "custom",
]);
export type RepRole = z.infer<typeof RepRole>;

export const RepStatus = z.enum(["draft", "active", "paused", "retired"]);
export type RepStatus = z.infer<typeof RepStatus>;

/**
 * The persona contract. This is the canonical source the writer-agent and
 * the hot-path judge read. Keep it small and opinionated — voice fingerprints
 * are computed elsewhere from `samples`.
 */
export const RepPersona = z.object({
  voice: z.string().describe("One paragraph describing how this Rep writes."),
  story: z
    .string()
    .optional()
    .describe("Who the Rep is, who they work for, what they care about."),
  kpis: z
    .array(z.string())
    .default([])
    .describe("What the Rep is optimizing for, in plain English."),
  do_not: z
    .array(z.string())
    .default([])
    .describe("Hard constraints (topics, words, tones to avoid)."),
  samples: z
    .array(z.string())
    .default([])
    .describe(
      "Canonical short writing samples in the Rep's voice. Used to compute the voice fingerprint.",
    ),
});
export type RepPersona = z.infer<typeof RepPersona>;

/**
 * Autonomy posture. Per-channel volume + approval policy. The runtime
 * gating logic lives in core/plays/ (autonomy is *per Play × channel*; the
 * Rep-level value here is the default that a Play inherits when it has
 * nothing channel-specific to say).
 */
export const ChannelAutonomy = z.object({
  daily_cap: z.number().int().nonnegative().default(0),
  approval: z
    .enum(["none", "approve_first", "always", "research_only"])
    .default("approve_first"),
});
export type ChannelAutonomy = z.infer<typeof ChannelAutonomy>;

export const RepAutonomy = z.object({
  channels: z.record(z.string(), ChannelAutonomy).default({}),
  global: z
    .object({
      max_concurrent_conversations: z.number().int().positive().optional(),
    })
    .default({}),
});
export type RepAutonomy = z.infer<typeof RepAutonomy>;

export const Rep = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  name: z.string().min(1),
  role: RepRole,
  status: RepStatus,
  persona: RepPersona,
  channels: z.array(z.string()).default([]),
  autonomy: RepAutonomy,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Rep = z.infer<typeof Rep>;
