/**
 * Email channel — Layer 4.
 *
 * Two sub-channels, two reputation games:
 *   - owned_domain  : AWS SES, workspace-owned domains, warmup state machine
 *   - oauth_outlook : connected user inbox via Microsoft Graph
 *
 * Gmail is intentionally not supported. Transactional product email lives
 * in `./transactional.ts` and is NOT a Rep-callable channel — separate
 * sender, separate reputation, separate API.
 *
 * See ARCHITECTURE.md "Channels" + db/migrations/011_channel_accounts.sql.
 */

export * from "./types.ts";
export * from "./caps.ts";
export * from "./warmup.ts";
export { readEvalState } from "./eval-gate.ts";
export type { EvalState } from "./eval-gate.ts";
export {
  createEmailChannel,
  createDefaultEmailChannel,
  createMessageRow,
  EMAIL_CHANNEL,
  EMAIL_SUB_CHANNELS,
} from "./send.ts";
export type { EmailChannelDeps } from "./send.ts";
export { handleBounce } from "./bounces.ts";
export {
  createTransactionalSender,
} from "./transactional.ts";
export type {
  TransactionalOptions,
  TransactionalSender,
  TransactionalSendInput,
} from "./transactional.ts";
export {
  registerEmailTools,
  _resetEmailToolsRegistration,
} from "./tools.ts";
export { createSesSender } from "./adapters/ses.ts";
export type { SesSender, SesSenderOptions, SesSendInput } from "./adapters/ses.ts";
export {
  createOutlookSender,
  OutlookAuthError,
  OutlookSendError,
} from "./adapters/outlook.ts";
export type {
  OutlookSender,
  OutlookSenderOptions,
  OutlookSendInput,
  OutlookCredentials,
} from "./adapters/outlook.ts";
