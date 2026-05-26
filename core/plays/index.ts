/**
 * Plays — declarative workflows. Per ARCHITECTURE.md, Plays are authored
 * in natural language and compiled to durable workflows; for foundation we
 * hand-author the compiled form. NL → spec compilation comes when there's
 * a second Play that justifies the abstraction.
 */

export {
  createSeriesAColdOpenPlay,
} from "./series_a_cold_open.ts";
export type {
  ColdOpenInput,
  ColdOpenOutput,
  SeriesAColdOpenDeps,
} from "./series_a_cold_open.ts";

export { seedMayaForDemo } from "./seed.ts";
export type { SeedMayaResult, SeedMayaOptions } from "./seed.ts";

export {
  createSignalToEmailPlayWorkflow,
  SIGNAL_TO_EMAIL_PLAY_WORKFLOW,
} from "./signal-email-play.ts";
export type {
  SignalToEmailPlayDeps,
  SignalToEmailPlayInput,
  SignalToEmailPlayOutput,
} from "./signal-email-play.ts";
export {
  createInMemoryVerticalSliceStore,
  createPostgresVerticalSliceStore,
} from "./vertical-store.ts";
export type {
  CreateConversationInput,
  CreateDraftMessageInput,
  CountPlayChannelMessagesInput,
  RecordOutcomeInput,
  VerticalSliceStore,
  VerticalSliceStoreSeed,
} from "./vertical-store.ts";
export {
  isDailyCapExceeded,
  nextDailyWindow,
  parseApprovalPolicy,
  resolvePlayChannelPolicy,
  shouldRequestApproval,
} from "./autonomy.ts";
export type { ApprovalPolicy, PlayChannelPolicy } from "./autonomy.ts";
export { runFirstVerticalSlice } from "./demo.ts";
export type { FirstVerticalSliceResult, RunFirstVerticalSliceOptions } from "./demo.ts";
