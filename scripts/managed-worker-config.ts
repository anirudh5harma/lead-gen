const RESTATE_CAPABLE_TARGETS = new Set([
  "worker:production",
  "worker:restate-workflows",
]);

export function moduleForTarget(command: string | undefined): string {
  switch (command) {
    case "worker:production":
      return "./production-worker.ts";
    case "worker:email-projectors":
      return "./email-projectors-worker.ts";
    case "worker:signal-projectors":
      return "./signal-projectors-worker.ts";
    case "worker:projectors":
      return "./projectors-worker.ts";
    case "worker:restate-workflows":
      return "./restate-workflows-worker.ts";
    default:
      throw new Error(
        "WORKER_TARGET_COMMAND must be worker:production, worker:email-projectors, worker:signal-projectors, worker:projectors, or worker:restate-workflows",
      );
  }
}

export function resolveWorkerHealthPort(
  target: string | undefined,
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.WORKER_HEALTH_PORT?.trim();
  const port = raw
    ? parsePort(raw, "WORKER_HEALTH_PORT")
    : RESTATE_CAPABLE_TARGETS.has(target ?? "")
      ? 9081
      : 9080;

  if (RESTATE_CAPABLE_TARGETS.has(target ?? "")) {
    const restatePort = parsePort(env.RESTATE_WORKFLOW_PORT?.trim() || "9080", "RESTATE_WORKFLOW_PORT");
    if (port === restatePort) {
      throw new Error(
        "WORKER_HEALTH_PORT must differ from RESTATE_WORKFLOW_PORT for Restate-capable managed workers",
      );
    }
  }

  return port;
}

function parsePort(raw: string, key: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`${key} must be an integer port between 1 and 65535`);
  }
  return port;
}
