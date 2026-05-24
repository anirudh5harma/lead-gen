/**
 * Rep composition. Users see Reps; agents under the hood are an
 * implementation detail.
 */

export * from "./types.ts";
export { composeRep } from "./compose.ts";

// Concrete role agents — the production wirings.
export { createDeepSeekWriter, buildPatternKey, WriterOutputError } from "./roles/writer.ts";
export type {
  WriterBrief,
  WriterDraft,
  DeepSeekWriterOptions,
} from "./roles/writer.ts";

export { createEmailSender } from "./roles/sender.ts";
export type { SenderRequest, SenderResult, EmailSenderOptions } from "./roles/sender.ts";

// Stubs for roles not yet implemented. These throw on invoke with a clear
// message so the failure is loud, not silent.
export { researcherStub } from "./roles/researcher.ts";
export { replierStub } from "./roles/replier.ts";
