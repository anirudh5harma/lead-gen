import type { Pool } from "pg";
import {
  createRuntimeEventBus,
  type RuntimeEventBus,
} from "../substrate/events/index.ts";
import {
  createPostgresEventBus,
  type PostgresEventBus,
} from "../substrate/events/adapters/postgres.ts";
import {
  createPostgresWorkflowRuntime,
  createRestateWorkflowRuntime,
} from "../substrate/workflows/index.ts";
import type { WorkflowRuntime } from "../substrate/workflows/index.ts";

export type ProductSubstrateMode = "postgres" | "nats_restate";

export interface ProductSubstrate {
  mode: ProductSubstrateMode;
  bus: PostgresEventBus | RuntimeEventBus;
  runtime: WorkflowRuntime;
}

export interface ProductSubstrateResolution {
  mode: ProductSubstrateMode | null;
  status: "ok" | "unsupported";
  detail: string;
}

const SUPPORTED_PRODUCT_SUBSTRATES = new Set<ProductSubstrateMode>([
  "postgres",
  "nats_restate",
]);

export function resolveProductSubstrateMode(
  raw = process.env.BOMBSELL_SUBSTRATE,
): ProductSubstrateResolution {
  const value = (raw?.trim().toLowerCase() || "postgres") as ProductSubstrateMode;
  if (SUPPORTED_PRODUCT_SUBSTRATES.has(value)) {
    return {
      mode: value,
      status: "ok",
      detail:
        value === "nats_restate"
          ? "Journaled NATS event bus + Restate workflow ingress"
          : "Postgres event bus + Postgres workflow journal",
    };
  }
  return {
    mode: null,
    status: "unsupported",
    detail:
      `Unsupported BOMBSELL_SUBSTRATE=${value}. ` +
      "Supported: postgres, nats_restate.",
  };
}

export async function createProductSubstrate(
  pool: Pool,
): Promise<ProductSubstrate> {
  const resolution = resolveProductSubstrateMode();
  if (resolution.status !== "ok" || !resolution.mode) {
    throw new Error(resolution.detail);
  }
  if (resolution.mode === "nats_restate") {
    const ingressUrl = process.env.RESTATE_INGRESS_URL?.trim();
    if (!ingressUrl) {
      throw new Error("RESTATE_INGRESS_URL is required for BOMBSELL_SUBSTRATE=nats_restate");
    }
    const bus = await createRuntimeEventBus({ pool });
    const runtime = createRestateWorkflowRuntime({ ingressUrl });
    return {
      mode: "nats_restate",
      bus,
      runtime,
    };
  }

  const bus = await createPostgresEventBus({ pool });
  const runtime = createPostgresWorkflowRuntime({ pool, bus });
  return {
    mode: "postgres",
    bus,
    runtime,
  };
}
