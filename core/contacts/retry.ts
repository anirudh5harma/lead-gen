import { defineWorkflow } from "../substrate/workflows/index.ts";
import type { ContactChannel } from "./resolution.ts";

export const CONTACT_RESOLUTION_RETRY_WORKFLOW =
  "contact.enrichment.retry.v1";
export const CONTACT_RESOLUTION_MAX_RETRIES = 3;

const RETRY_DELAYS_MS = [
  15 * 60_000,
  2 * 60 * 60_000,
  12 * 60 * 60_000,
] as const;

export interface ContactResolutionRetryInput {
  workspace_id: string;
  signal_id: string;
  company_id: string;
  play_id: string;
  rep_id: string;
  channel: ContactChannel;
  retry_attempt: number;
  deferred_event_id: string;
  defer_reason: string;
}

export interface ContactResolutionRetryOutput {
  decision: "retry_requested" | "exhausted";
  attempt: number;
}

export function contactResolutionRetryDelayMs(attempt: number): number {
  const index = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, Math.trunc(attempt) - 1));
  return RETRY_DELAYS_MS[index]!;
}

export function createContactResolutionRetryWorkflow(
  opts: { now?: () => Date } = {},
) {
  const now = opts.now ?? (() => new Date());
  return defineWorkflow<ContactResolutionRetryInput, ContactResolutionRetryOutput>({
    name: CONTACT_RESOLUTION_RETRY_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      const attempt = Math.max(0, Math.trunc(input.retry_attempt)) + 1;
      const exhausted = attempt > CONTACT_RESOLUTION_MAX_RETRIES;

      if (!exhausted) {
        await ctx.sleep(contactResolutionRetryDelayMs(attempt));
      }

      const requested_at = await ctx.step(
        "contact.retry.requested_at",
        async () => now().toISOString(),
      );
      await ctx.publish("contact.resolution.retry.requested", {
        signal_id: input.signal_id,
        company_id: input.company_id,
        play_id: input.play_id,
        rep_id: input.rep_id,
        channel: input.channel,
        attempt,
        source_deferred_event_id: input.deferred_event_id,
        defer_reason: input.defer_reason,
        requested_at,
        ...(exhausted ? { exhausted: true } : {}),
      });

      return {
        decision: exhausted ? "exhausted" : "retry_requested",
        attempt,
      };
    },
  });
}
