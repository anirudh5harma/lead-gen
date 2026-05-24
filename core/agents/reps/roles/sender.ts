import {
  createEmailChannel,
  type EmailChannelDeps,
  type SendOptions,
  type SendResult,
} from "../../../channels/email/index.ts";
import type { RoleAgent, RoleAgentContext } from "../types.ts";

/**
 * Sender role agent — email implementation. A thin role-agent wrapper
 * around the email channel's `send`. The channel itself enforces the
 * eval gate, caps, warmup, and frequency cap — the sender just decides
 * which sub-channel to use and routes the call.
 *
 * For pivot-v2 only `owned_domain` and `oauth_outlook` are supported
 * (Gmail intentionally out of scope; see ARCHITECTURE.md).
 */

export interface SenderRequest {
  conversation_id: string;
  message_id: string;
  channel_account_id: string;
  sub_channel: "owned_domain" | "oauth_outlook";
  sending_domain_id?: string;
  draft: SendOptions["draft"];
}

export type SenderResult = SendResult;

export interface EmailSenderOptions {
  emailChannelDeps: EmailChannelDeps;
}

export function createEmailSender(
  opts: EmailSenderOptions,
): RoleAgent<SenderRequest, SenderResult> {
  const channel = createEmailChannel(opts.emailChannelDeps);

  return {
    kind: "sender",
    name: "sender.email",
    async invoke(req: SenderRequest, ctx: RoleAgentContext): Promise<SenderResult> {
      return channel.send({
        workspace_id: ctx.rep.workspace_id,
        rep_id: ctx.rep.id,
        conversation_id: req.conversation_id,
        message_id: req.message_id,
        channel_account_id: req.channel_account_id,
        sub_channel: req.sub_channel,
        sending_domain_id: req.sending_domain_id,
        draft: req.draft,
      });
    },
  };
}
