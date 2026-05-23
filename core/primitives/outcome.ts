import { z } from "zod";

/**
 * Outcome — a scored, attributable result. The ONLY thing that gates learning
 * (procedural memory updates) and billing. One of the five primitives.
 * See ARCHITECTURE.md and db/migrations/010_primitive_outcome.sql.
 */

export const OutcomeKind = z.enum([
  "positive_reply",
  "meeting_booked",
  "opportunity_created",
  "deal_won",
  "deal_lost",
  "post_published",
  "follower_lift",
  "engagement_lift",
  "unsubscribe",
  "bounce",
  "do_not_contact",
]);
export type OutcomeKind = z.infer<typeof OutcomeKind>;

export const Outcome = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),

  kind: OutcomeKind,
  /** Normalized 0..1 (or signed for negative outcomes). Economic value in properties. */
  score: z.number(),

  conversation_id: z.string().uuid().nullable(),
  attributed_message_id: z.string().uuid().nullable(),
  attributed_signal_id: z.string().uuid().nullable(),
  attributed_play_id: z.string().uuid().nullable(),
  attributed_play_run_id: z.string().uuid().nullable(),
  attributed_rep_id: z.string().uuid().nullable(),

  subject_person_id: z.string().uuid().nullable(),
  subject_company_id: z.string().uuid().nullable(),

  properties: z.record(z.string(), z.unknown()).default({}),
  provenance: z.record(z.string(), z.unknown()).default({}),

  occurred_at: z.string().datetime(),
  recorded_at: z.string().datetime(),
});
export type Outcome = z.infer<typeof Outcome>;
