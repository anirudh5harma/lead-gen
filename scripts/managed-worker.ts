import { createServer } from "node:http";
import {
  moduleForTarget,
  resolveWorkerHealthPort,
} from "./managed-worker-config.ts";

const target = process.env.WORKER_TARGET_COMMAND?.trim();
const modulePath = moduleForTarget(target);
const port = resolveWorkerHealthPort(target);

let ready = false;
let fatal: string | null = null;

const server = createServer((req, res) => {
  if (req.url !== "/" && req.url !== "/health") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
    return;
  }
  const ok = ready && !fatal;
  res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok, target, fatal }));
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, () => {
    server.off("error", reject);
    resolve();
  });
});

console.log(`[managed-worker] health server listening on ${port} for ${target}`);

void import(modulePath)
  .then(() => {
    ready = true;
    console.log(`[managed-worker] ${target} started`);
  })
  .catch((err) => {
    fatal = err instanceof Error ? err.message : String(err);
    console.error(`[managed-worker] ${target} failed to start`, err);
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 250).unref();
  });
