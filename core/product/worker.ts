import { randomBytes } from "node:crypto";
import {
  dispatchRssSourceIngestionOnce,
  dispatchSignalPlaysOnce,
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
      const resumed = await resumeRunnableWorkflowsOnce({
        limit: batchSize,
        leaseOwner,
        leaseMs: opts.leaseMs,
      });
      const ingested = await dispatchRssSourceIngestionOnce({ limit: batchSize });
      const dispatched = await dispatchSignalPlaysOnce({ limit: batchSize });
      opts.onTick?.({ ingested, dispatched, resumed });
      if (opts.once) return;
    } catch (err) {
      onError(err);
      if (opts.once) throw err;
    }
    await delay(pollMs, opts.signal);
  }
}
