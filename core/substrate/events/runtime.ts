import type { Pool } from "pg";
import { isProduction } from "../../config/env.ts";
import type { EventBus } from "./bus.ts";
import { createJournaledNatsEventBus } from "./adapters/journaled-nats.ts";
import { createPostgresEventBus } from "./adapters/postgres.ts";
import { getPool } from "../storage/index.ts";

export interface RuntimeEventBus extends EventBus {
  close(): Promise<void>;
}

export interface RuntimeEventBusOptions {
  env?: Record<string, string | undefined>;
  pool?: Pool;
}

/**
 * Event-bus composition for app ingress. Production writes the canonical
 * event journal before NATS delivery, and is never permitted to fall back to
 * Postgres LISTEN/NOTIFY as its cross-process delivery bus.
 */
export async function createRuntimeEventBus(
  opts: RuntimeEventBusOptions = {},
): Promise<RuntimeEventBus> {
  const env = opts.env ?? process.env;
  const servers = env.NATS_URL?.trim();
  if (servers) {
    const credentials = env.NATS_CREDS?.trim();
    const natsOptions = {
      ...optionalPositiveNumber(env.NATS_STREAM_MAX_BYTES, "streamMaxBytes"),
      ...optionalPositiveNumber(env.NATS_STREAM_MAX_AGE_MS, "streamMaxAgeMs"),
    };
    return createJournaledNatsEventBus({
      pool: opts.pool ?? getPool(),
      servers,
      ...(credentials ? { credentials } : {}),
      ...natsOptions,
    });
  }
  if (isProduction(env)) {
    throw new Error("NATS_URL is required for the production event bus");
  }
  return createPostgresEventBus({ pool: opts.pool ?? getPool() });
}

function optionalPositiveNumber<K extends string>(
  raw: string | undefined,
  key: K,
): Partial<Record<K, number>> {
  if (!raw?.trim()) return {};
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a positive number`);
  }
  return { [key]: value } as Partial<Record<K, number>>;
}
