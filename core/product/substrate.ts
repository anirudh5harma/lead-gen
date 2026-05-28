import type { Pool } from "pg";
import {
  createPostgresEventBus,
  type PostgresEventBus,
} from "../substrate/events/adapters/postgres.ts";
import { createPostgresWorkflowRuntime } from "../substrate/workflows/index.ts";
import type { WorkflowRuntime } from "../substrate/workflows/index.ts";

export type ProductSubstrateMode = "postgres";

export interface ProductSubstrate {
  mode: ProductSubstrateMode;
  bus: PostgresEventBus;
  runtime: WorkflowRuntime;
}

export interface ProductSubstrateResolution {
  mode: ProductSubstrateMode | null;
  status: "ok" | "unsupported";
  detail: string;
}

const SUPPORTED_PRODUCT_SUBSTRATE: ProductSubstrateMode = "postgres";

export function resolveProductSubstrateMode(
  raw = process.env.BOMBSELL_SUBSTRATE,
): ProductSubstrateResolution {
  const value = raw?.trim().toLowerCase() || SUPPORTED_PRODUCT_SUBSTRATE;
  if (value === SUPPORTED_PRODUCT_SUBSTRATE) {
    return {
      mode: SUPPORTED_PRODUCT_SUBSTRATE,
      status: "ok",
      detail: "Postgres event bus + Postgres workflow journal",
    };
  }
  return {
    mode: null,
    status: "unsupported",
    detail: `Unsupported BOMBSELL_SUBSTRATE=${value}. Supported: ${SUPPORTED_PRODUCT_SUBSTRATE}. NATS/Restate adapters are contracts, not active product adapters yet.`,
  };
}

export async function createProductSubstrate(
  pool: Pool,
): Promise<ProductSubstrate> {
  const resolution = resolveProductSubstrateMode();
  if (resolution.status !== "ok" || resolution.mode !== "postgres") {
    throw new Error(resolution.detail);
  }
  const bus = await createPostgresEventBus({ pool });
  const runtime = createPostgresWorkflowRuntime({ pool, bus });
  return {
    mode: "postgres",
    bus,
    runtime,
  };
}
