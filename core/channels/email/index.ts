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
export {
  createDryRunEmailTransport,
  createOwnedDomainEmailChannel,
} from "./dry-run.ts";
export type { DryRunEmailTransport } from "./dry-run.ts";
export { createPostgresOwnedDomainEmailChannel } from "./postgres.ts";
export type { PostgresOwnedDomainEmailChannelOptions } from "./postgres.ts";
export { createResendEmailTransport } from "./resend.ts";
export type { ResendEmailTransportOptions } from "./resend.ts";
export { createResendDomainTransport } from "./domains.ts";
export type {
  EmailDomainDnsRecord,
  EmailDomainSnapshot,
  EmailDomainTransport,
  ResendDomainTransportOptions,
} from "./domains.ts";
export { handleBounce } from "./bounces.ts";
export { handleInboundEmail } from "./reply.ts";
export {
  projectOutlookAuthorization,
  projectOutlookCredentialsRefreshed,
  projectOutlookReauthorizationRequired,
  registerEmailIngressProjectors,
} from "./projectors.ts";
export type {
  EmailIngressProjectorDeps,
  EmailIngressSubscriber,
  OutlookSubscriptionRepairStarter,
} from "./projectors.ts";
export type {
  InboundEmail,
  HandleInboundDeps,
  HandleInboundResult,
} from "./reply.ts";
export {
  createDeepSeekIntentClassifier,
  createFixedIntentClassifier,
} from "./intent.ts";
export type {
  IntentClassifier,
  IntentClassifierInput,
  IntentClassification,
  ReplyIntent,
  DeepSeekIntentClassifierOptions,
} from "./intent.ts";
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
  OutlookAccessTokenProvider,
} from "./adapters/outlook.ts";
export {
  createOutlookSubscription,
  renewOutlookSubscription,
  deleteOutlookSubscription,
  loadSubscription as loadOutlookSubscription,
  persistOutlookSubscription,
  fetchOutlookMessage,
  graphMessageToInbound,
  isValidClientState,
  OutlookSubscriptionError,
} from "./outlook-subscription.ts";
export type {
  OutlookSubscription,
  OutlookSubscriptionRecord,
  OutlookChangeNotification,
  OutlookNotificationBatch,
  GraphMessage,
} from "./outlook-subscription.ts";
export { createOutlookSubscriptionRepairWorkflow } from "./outlook-subscription-workflow.ts";
export type {
  OutlookSubscriptionRepairDeps,
  OutlookSubscriptionRepairInput,
  OutlookSubscriptionRepairSummary,
} from "./outlook-subscription-workflow.ts";
export {
  parseSnsEnvelope,
  parseSnsNotification,
  SnsParseError,
} from "./ses-inbound.ts";
export type {
  SnsMessageEnvelope,
  SnsParsedNotification,
  SesNotification,
} from "./ses-inbound.ts";
export {
  allowedSnsTopicArns,
  snsStringToSign,
  validSnsUrl,
  verifySnsMessage,
  SnsConfigurationError,
  SnsVerificationError,
} from "./sns-verify.ts";
export type { VerifySnsMessageOptions } from "./sns-verify.ts";
