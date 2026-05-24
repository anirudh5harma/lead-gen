import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
} from "@aws-sdk/client-sesv2";
import type { EmailDraft } from "../types.ts";

/**
 * AWS SES v2 adapter. Owned-domain sending. The platform owns the AWS
 * account; per-workspace credential isolation is an enterprise-tier
 * concern not handled here.
 *
 * Environment:
 *   AWS_REGION                 (default us-east-1)
 *   AWS_ACCESS_KEY_ID          (or use the default credential chain)
 *   AWS_SECRET_ACCESS_KEY
 *
 * The adapter is intentionally thin: it accepts a draft + a verified
 * From address (already validated by the warmup module) and returns the
 * SES message id. Higher-level policy (autonomy, caps, frequency) lives
 * in `send.ts`.
 */

export interface SesSenderOptions {
  /** Inject a configured client (tests). Defaults to one constructed from env. */
  client?: SESv2Client;
  /** Override the default From — typically derived from the sending_domain. */
  defaultFrom?: string;
}

export interface SesSendInput {
  draft: EmailDraft;
  from: string;
  /** SES configuration set, e.g. for bounce/complaint event publishing. */
  configurationSetName?: string;
  /** Optional tag pairs (workspace_id, message_id) for the SES event stream. */
  tags?: Array<{ Name: string; Value: string }>;
}

export interface SesSender {
  send(input: SesSendInput): Promise<{ external_id: string }>;
}

function addressesToHeaderList(addrs?: { email: string; name?: string }[]): string[] {
  return (addrs ?? []).map((a) => (a.name ? `${a.name} <${a.email}>` : a.email));
}

function rfcAddress(addr: { email: string; name?: string }): string {
  return addr.name ? `${addr.name} <${addr.email}>` : addr.email;
}

export function createSesSender(opts: SesSenderOptions = {}): SesSender {
  const client = opts.client ?? new SESv2Client({});

  return {
    async send({ draft, from, configurationSetName, tags }): Promise<{ external_id: string }> {
      const headers: Record<string, string> = { ...(draft.headers ?? {}) };
      if (draft.in_reply_to) headers["In-Reply-To"] = draft.in_reply_to;
      if (draft.references?.length) {
        headers["References"] = draft.references.join(" ");
      }

      const input: SendEmailCommandInput = {
        FromEmailAddress: from,
        Destination: {
          ToAddresses: [rfcAddress(draft.to)],
          CcAddresses: addressesToHeaderList(draft.cc),
          BccAddresses: addressesToHeaderList(draft.bcc),
        },
        ReplyToAddresses: draft.reply_to
          ? [rfcAddress(draft.reply_to)]
          : undefined,
        Content: {
          Simple: {
            Subject: { Data: draft.subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: draft.body_text, Charset: "UTF-8" },
              ...(draft.body_html && {
                Html: { Data: draft.body_html, Charset: "UTF-8" },
              }),
            },
            Headers: Object.entries(headers).map(([Name, Value]) => ({
              Name,
              Value,
            })),
          },
        },
        ConfigurationSetName: configurationSetName,
        EmailTags: tags,
      };

      const result = await client.send(new SendEmailCommand(input));
      if (!result.MessageId) {
        throw new Error("SES returned a successful response with no MessageId");
      }
      return { external_id: result.MessageId };
    },
  };
}
