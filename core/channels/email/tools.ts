import { z } from "zod";
import { getPool } from "../../substrate/storage/index.ts";
import { registerTool } from "../../agents/tools/registry.ts";
import { createEmailChannel } from "./send.ts";
import type { EmailChannelDeps } from "./send.ts";

/**
 * Register email Tools. Internal Reps and external agents call them the
 * same way. The Tool registry resolves the pool via `getPool()`; the
 * SES + Outlook adapter instances live behind a closure so we don't
 * recreate them on every invocation.
 *
 * Idempotent: registering twice no-ops (mirrors the pattern in
 * core/graph/tools.ts).
 */

const EmailAddressSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
});

const EmailDraftSchema = z.object({
  to: EmailAddressSchema,
  cc: z.array(EmailAddressSchema).optional(),
  bcc: z.array(EmailAddressSchema).optional(),
  subject: z.string().min(1),
  body_text: z.string(),
  body_html: z.string().optional(),
  reply_to: EmailAddressSchema.optional(),
  in_reply_to: z.string().optional(),
  references: z.array(z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

const SendInputSchema = z.object({
  conversation_id: z.string().uuid(),
  message_id: z.string().uuid(),
  channel_account_id: z.string().uuid(),
  sub_channel: z.enum(["owned_domain", "oauth_outlook"]),
  sending_domain_id: z.string().uuid().optional(),
  draft: EmailDraftSchema,
});

const SendResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("sent"),
    message_id: z.string().uuid(),
    external_id: z.string(),
    sub_channel: z.enum(["owned_domain", "oauth_outlook"]),
  }),
  z.object({
    status: z.literal("deferred"),
    message_id: z.string().uuid(),
    reason: z.string(),
    detail: z.string().optional(),
    retry_after: z.string().optional(),
  }),
]);

let registered = false;

export interface EmailToolDeps
  extends Omit<EmailChannelDeps, "pool"> {
  /** Optional override of the pool resolver. Defaults to getPool(). */
  resolvePool?: () => EmailChannelDeps["pool"];
}

export function registerEmailTools(deps: EmailToolDeps): void {
  if (registered) return;
  registered = true;

  const resolvePool = deps.resolvePool ?? getPool;

  registerTool({
    name: "email.send",
    description:
      "Send an email through the workspace's email channel. Picks owned-domain " +
      "(AWS SES) or connected Outlook based on `sub_channel`. Refuses to send " +
      "unless evalGate has emitted a passing draft.judged for the message_id. " +
      "Returns either a sent confirmation with the provider's external id, or a " +
      "deferred result naming the reason (cap, frequency, warmup, account).",
    kind: "external",
    input: SendInputSchema,
    output: SendResultSchema,
    async handler(input, ctx) {
      const channel = createEmailChannel({
        ...deps,
        pool: resolvePool(),
      });
      return channel.send({
        workspace_id: ctx.workspace_id,
        rep_id: ctx.rep_id ?? "",
        conversation_id: input.conversation_id,
        message_id: input.message_id,
        channel_account_id: input.channel_account_id,
        sub_channel: input.sub_channel,
        sending_domain_id: input.sending_domain_id,
        draft: input.draft,
      });
    },
  });
}

export function _resetEmailToolsRegistration(): void {
  registered = false;
}
