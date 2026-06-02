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
 * Product runtime:
 *   use `createProductSubstrate()` from core/product/substrate. Production
 *   selects `BOMBSELL_SUBSTRATE=nats_restate` for NATS + Restate; local/dev can
 *   keep the Postgres-backed bridge.
 */

export * from "./types.ts";
export { defineWorkflow } from "./define.ts";
export { createInProcessWorkflowRuntime } from "./adapters/in-process.ts";
export type { InProcessWorkflowRuntimeOptions } from "./adapters/in-process.ts";
export {
  createRestateWorkflowRuntime,
  restateBearerFromEnv,
} from "./adapters/restate.ts";
export type { RestateRuntimeOptions } from "./adapters/restate.ts";
export {
  createRestateWorkflowComponent,
  createRunContext as createRestateRunContext,
  serveRestateWorkflows,
} from "./adapters/restate-host.ts";
export type {
  RestateWorkflowHostOptions,
  RestateWorkflowRequest,
} from "./adapters/restate-host.ts";
export {
  createPostgresRestateEventSignalStore,
  deliverEventToRestateWaits,
  startRestateEventSignalBridge,
} from "./adapters/restate-signal-bridge.ts";
export type {
  PostgresRestateEventSignalStore,
  RestateEventSignal,
  RestateEventSignalBridgeOptions,
  RestateEventSignalStore,
  RestateEventWaitRegistration,
} from "./adapters/restate-signal-bridge.ts";
export { triggerDueWorkspaceMaintenance } from "./maintenance-trigger.ts";
export type {
  WorkspaceMaintenanceStartFailure,
  WorkspaceMaintenanceTriggerDeps,
  WorkspaceMaintenanceTriggerSummary,
} from "./maintenance-trigger.ts";
export {
  createRestateRuntimeProbeWorkflow,
  RESTATE_RUNTIME_PROBE_WORKFLOW,
} from "./probe.ts";
export type {
  RestateRuntimeProbeInput,
  RestateRuntimeProbeOutput,
} from "./probe.ts";
export { createPostgresWorkflowRuntime } from "./adapters/postgres.ts";
export type { PostgresWorkflowRuntimeOptions } from "./adapters/postgres.ts";
