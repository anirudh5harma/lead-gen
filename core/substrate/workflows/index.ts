/**
 * Durable workflow runtime — the only orchestration primitive in pivot-v2.
 *
 * Every long-running operation goes through a workflow. Vercel crons are
 * forbidden for sequencing (see AGENTS.md). Crons may exist only as
 * thin event-emitters that publish a typed event; the workflow runtime
 * picks it up via ctx.awaitEvent or via a Play trigger.
 *
 * Dev / tests:
 *   import {
 *     createInProcessWorkflowRuntime,
 *     defineWorkflow,
 *   } from "@/core/substrate/workflows";
 *
 * Production (when landed):
 *   import { createRestateWorkflowRuntime } from "@/core/substrate/workflows";
 */

export * from "./types.ts";
export { defineWorkflow } from "./define.ts";
export { createInProcessWorkflowRuntime } from "./adapters/in-process.ts";
export type { InProcessWorkflowRuntimeOptions } from "./adapters/in-process.ts";
export { createRestateWorkflowRuntime } from "./adapters/restate.ts";
export type { RestateRuntimeOptions } from "./adapters/restate.ts";
export { createPostgresWorkflowRuntime } from "./adapters/postgres.ts";
export type { PostgresWorkflowRuntimeOptions } from "./adapters/postgres.ts";
