import { Resend } from "resend";

/**
 * Transactional email — receipts, lifecycle, password reset, magic links.
 * Per ARCHITECTURE.md, this is intentionally SEPARATE from the prospecting
 * channel:
 *
 *   - Different reputation profile (transactional inbox placement is fragile
 *     and recovers slowly; a single misfire taints months of warmup).
 *   - Sent under a distinct sub-domain (e.g. `mail.bombsell.com`) with its
 *     own SPF/DKIM/DMARC.
 *   - NEVER callable by a Rep. This is product infrastructure, not a Tool.
 *     The MCP server does not expose it.
 *
 * Backed by Resend. Workspaces don't customise the transactional sender;
 * it's the platform's voice for the platform's product.
 */

export interface TransactionalSendInput {
  to: string;
  subject: string;
  /** Plain-text version. Required for inbox placement. */
  text: string;
  html?: string;
  /** Tag for product analytics (e.g. 'welcome', 'invoice'). */
  category: string;
  /** Reply-To, if the recipient should reply somewhere other than no-reply. */
  reply_to?: string;
}

export interface TransactionalSender {
  send(input: TransactionalSendInput): Promise<{ external_id: string }>;
}

export interface TransactionalOptions {
  /** Defaults to RESEND_API_KEY env. */
  apiKey?: string;
  /** Default From, e.g. 'Bombsell <no-reply@mail.bombsell.com>'. */
  from: string;
  /** Inject a Resend client (tests). */
  client?: Resend;
}

export function createTransactionalSender(
  opts: TransactionalOptions,
): TransactionalSender {
  const apiKey = opts.apiKey ?? process.env.RESEND_API_KEY;
  if (!opts.client && !apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set. The transactional sender needs a Resend key.",
    );
  }
  const client = opts.client ?? new Resend(apiKey as string);

  return {
    async send(input: TransactionalSendInput): Promise<{ external_id: string }> {
      const result = await client.emails.send({
        from: opts.from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
        replyTo: input.reply_to,
        tags: [{ name: "category", value: input.category }],
      });
      if (result.error) {
        throw new Error(
          `Resend send failed: ${result.error.message ?? JSON.stringify(result.error)}`,
        );
      }
      if (!result.data?.id) {
        throw new Error("Resend returned a success response with no id");
      }
      return { external_id: result.data.id };
    },
  };
}
