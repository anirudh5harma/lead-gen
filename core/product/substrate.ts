import type { Pool } from "pg";
import {
  createJournaledDispatchEventBus,
  type JournaledDispatchEventBus,
} from "../substrate/events/index.ts";
import {
  createPostgresEventBus,
  type PostgresEventBus,
} from "../substrate/events/adapters/postgres.ts";
import {
  createPostgresWorkflowRuntime,
  createRestateWorkflowRuntime,
  restateBearerFromEnv,
} from "../substrate/workflows/index.ts";
import type { WorkflowRuntime } from "../substrate/workflows/index.ts";

export type ProductSubstrateMode = "postgres" | "nats_restate";

export interface ProductSubstrate {
  mode: ProductSubstrateMode;
  bus: PostgresEventBus | JournaledDispatchEventBus;
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
  env: Record<string, string | undefined> = process.env,
): ProductSubstrateResolution {
  const requested = (raw?.trim().toLowerCase() || "postgres") as ProductSubstrateMode;
  const promotedToDurable =
    requested === "postgres" &&
    env.NODE_ENV === "production" &&
    Boolean(env.RESTATE_INGRESS_URL?.trim());
  const value = (promotedToDurable ? "nats_restate" : requested) as ProductSubstrateMode;
  if (SUPPORTED_PRODUCT_SUBSTRATES.has(value)) {
    return {
      mode: value,
      status: "ok",
      detail:
        promotedToDurable
          ? "Production auto-promoted from postgres to durable Restate workflow ingress"
          : value === "nats_restate"
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
  if (
    process.env.NODE_ENV === "production" &&
    resolution.mode === "postgres"
  ) {
    throw new Error(
      "Production requires the durable nats_restate substrate. Configure RESTATE_INGRESS_URL or remove the postgres override.",
    );
  }
  if (resolution.mode === "nats_restate") {
    const ingressUrl = process.env.RESTATE_INGRESS_URL?.trim();
    if (!ingressUrl) {
      throw new Error("RESTATE_INGRESS_URL is required for BOMBSELL_SUBSTRATE=nats_restate");
    }
    const bus = await createJournaledDispatchEventBus({ pool });
    const runtime = createRestateWorkflowRuntime({
      ingressUrl,
      bearer: restateBearerFromEnv(),
    });
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
