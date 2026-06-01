import { randomBytes } from "node:crypto";
import {
  dispatchRssSourceIngestionOnce,
  dispatchReplyEmailPlaysOnce,
  dispatchSendingDomainWarmupsOnce,
  dispatchSignalPlaysOnce,
  dispatchWorkspaceSourcePollsOnce,
  projectPendingProductEventsOnce,
  resumeRunnableWorkflowsOnce,
} from "./app.ts";

export interface ProductWorkerOptions {
  pollMs?: number;
  batchSize?: number;
  leaseMs?: number;
  leaseOwner?: string;
  once?: boolean;
  signal?: AbortSignal;
  onError?: (err: unknown) => void;
  onTick?: (stats: ProductWorkerTick) => void;
}

export interface ProductWorkerTick {
  ingested: number;
  dispatched: number;
  resumed: number;
  warmed: number;
  projected: number;
  projectionFailed: number;
  replyDispatched: number;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

export async function runProductWorker(
  opts: ProductWorkerOptions = {},
): Promise<void> {
  const pollMs = opts.pollMs ?? 1000;
  const batchSize = opts.batchSize ?? 25;
  const leaseOwner =
    opts.leaseOwner ?? `product-worker:${process.pid}:${randomBytes(4).toString("hex")}`;
  const onError = opts.onError ?? ((err) => console.error("[product-worker]", err));

  while (!opts.signal?.aborted) {
    try {
      const projections = await projectPendingProductEventsOnce({
        limit: batchSize,
        leaseOwner,
        leaseMs: opts.leaseMs,
      });
      const resumed = await resumeRunnableWorkflowsOnce({
        limit: batchSize,
        leaseOwner,
        leaseMs: opts.leaseMs,
      });
      const legacyRss = await dispatchRssSourceIngestionOnce({ limit: batchSize });
      const workspacePolls = await dispatchWorkspaceSourcePollsOnce({ limit: batchSize });
      const warmed = await dispatchSendingDomainWarmupsOnce({ limit: batchSize });
      const dispatched = await dispatchSignalPlaysOnce({ limit: batchSize });
      const replyDispatched = await dispatchReplyEmailPlaysOnce({ limit: batchSize });
      opts.onTick?.({
        ingested: legacyRss + workspacePolls,
        dispatched,
        resumed,
        warmed,
        projected: projections.completed,
        projectionFailed: projections.failed,
        replyDispatched,
      });
      if (opts.once) return;
    } catch (err) {
      onError(err);
      if (opts.once) throw err;
    }
    await delay(pollMs, opts.signal);
  }
}
