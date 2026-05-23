/**
 * Rep composition. Users see Reps; agents under the hood are an
 * implementation detail.
 */

export * from "./types.ts";
export { composeRep } from "./compose.ts";
export { researcherStub } from "./roles/researcher.ts";
export { writerStub } from "./roles/writer.ts";
export { senderStub } from "./roles/sender.ts";
export { replierStub } from "./roles/replier.ts";
