#!/usr/bin/env node
import { runProductWorker } from "../core/product/worker.ts";

const once = process.argv.includes("--once");
const pollMsArg = process.argv.find((arg) => arg.startsWith("--poll-ms="));
const batchArg = process.argv.find((arg) => arg.startsWith("--batch-size="));
const pollMs = pollMsArg ? Number(pollMsArg.split("=")[1]) : undefined;
const batchSize = batchArg ? Number(batchArg.split("=")[1]) : undefined;

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => controller.abort());
}

await runProductWorker({
  once,
  pollMs: Number.isFinite(pollMs) ? pollMs : undefined,
  batchSize: Number.isFinite(batchSize) ? batchSize : undefined,
  signal: controller.signal,
  onTick({
    ingested,
    dispatched,
    resumed,
    warmed,
    projected,
    projectionFailed,
    replyDispatched,
    recommendationDispatched,
  }) {
    if (
      ingested ||
      dispatched ||
      resumed ||
      warmed ||
      projected ||
      projectionFailed ||
      replyDispatched ||
      recommendationDispatched ||
      once
    ) {
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          ingested,
          dispatched,
          resumed,
          warmed,
          projected,
          projectionFailed,
          replyDispatched,
          recommendationDispatched,
        }),
      );
    }
  },
});
