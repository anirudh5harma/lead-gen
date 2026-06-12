export function resolveRestateWorkflowPort(
  env: Record<string, string | undefined> = process.env,
): number {
  const explicitRestatePort = env.RESTATE_WORKFLOW_PORT?.trim();
  const providerPort = env.PORT?.trim();
  return parsePort(
    explicitRestatePort || providerPort || "9080",
    explicitRestatePort ? "RESTATE_WORKFLOW_PORT" : providerPort ? "PORT" : "RESTATE_WORKFLOW_PORT",
  );
}

function parsePort(raw: string, key: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`${key} must be an integer port between 1 and 65535`);
  }
  return port;
}
