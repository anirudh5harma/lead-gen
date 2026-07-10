import { withTransientConnectionRetry } from "@/core/substrate/storage/index.ts";

const DEFAULT_DASHBOARD_DATA_CONCURRENCY = 4;
const MAX_DASHBOARD_DATA_CONCURRENCY = 20;

let activeDashboardLoads = 0;
const dashboardLoadWaiters: Array<() => void> = [];

export async function loadDashboardData<T>(
  surface: string,
  loader: string,
  fallback: T,
  load: () => Promise<T>,
): Promise<T> {
  const release = await acquireDashboardDataSlot();
  try {
    return await withTransientConnectionRetry(load);
  } catch (error) {
    console.error(`[dashboard/${surface}] failed to load ${loader}`, error);
    return fallback;
  } finally {
    release();
  }
}

async function acquireDashboardDataSlot(): Promise<() => void> {
  if (activeDashboardLoads < dashboardDataConcurrencyLimit()) {
    activeDashboardLoads += 1;
    return releaseDashboardDataSlot;
  }
  await new Promise<void>((resolve) => {
    dashboardLoadWaiters.push(resolve);
  });
  return releaseDashboardDataSlot;
}

function releaseDashboardDataSlot(): void {
  const next = dashboardLoadWaiters.shift();
  if (next) {
    next();
    return;
  }
  activeDashboardLoads = Math.max(0, activeDashboardLoads - 1);
}

function dashboardDataConcurrencyLimit(): number {
  const configured = positiveInteger(process.env.DASHBOARD_DATA_CONCURRENCY);
  if (configured !== null) {
    return Math.min(MAX_DASHBOARD_DATA_CONCURRENCY, configured);
  }
  const poolMax = positiveInteger(process.env.DATABASE_POOL_MAX) ?? 10;
  return Math.max(
    1,
    Math.min(DEFAULT_DASHBOARD_DATA_CONCURRENCY, poolMax - 2),
  );
}

function positiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.trunc(parsed);
}
