import { z } from "zod";

/**
 * Signal — a typed event that may justify action. One of the five primitives.
 * See ARCHITECTURE.md and db/migrations/006_primitive_signal.sql.
 */

export const SignalKind = z.enum([
  "funding",
  "hiring",
  "leadership_change",
  "product_launch",
  "acquisition",
  "churn_risk",
  "competitor_move",
  "podcast_mention",
  "press_mention",
  "regulation",
  "expansion",
  "layoff",
  "other",
]);
export type SignalKind = z.infer<typeof SignalKind>;

export const SignalStatus = z.enum([
  "ingested",
  "matched",
  "in_play",
  "spent",
  "dismissed",
]);
export type SignalStatus = z.infer<typeof SignalStatus>;

/**
 * ICP match metadata produced by the matcher agent. Open-ended so different
 * matchers can record their own reasoning shape.
 */
export const AudienceHint = z
  .object({
    icp_segment: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    rationale: z.string().optional(),
  })
  .passthrough();
export type AudienceHint = z.infer<typeof AudienceHint>;

export const Signal = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  source_id: z.string().uuid().nullable(),

  kind: SignalKind,
  title: z.string().min(1),
  content: z.string().nullable(),
  url: z.string().url().nullable(),

  novelty_key: z.string().nullable(),
  novelty_score: z.number().min(0).max(1).nullable(),

  freshness_at: z.string().datetime(),

  audience_hint: AudienceHint.default({}),
  match_score: z.number().min(0).max(1).nullable(),
  match_reason: z.string().nullable(),

  related_company_id: z.string().uuid().nullable(),
  related_person_id: z.string().uuid().nullable(),

  status: SignalStatus,
  properties: z.record(z.string(), z.unknown()).default({}),
  provenance: z.record(z.string(), z.unknown()).default({}),

  ingested_at: z.string().datetime(),
});
export type Signal = z.infer<typeof Signal>;
