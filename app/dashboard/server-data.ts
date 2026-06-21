import { withTransientConnectionRetry } from "@/core/substrate/storage/index.ts";

export async function loadDashboardData<T>(
  surface: string,
  loader: string,
  fallback: T,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await withTransientConnectionRetry(load);
  } catch (error) {
    console.error(`[dashboard/${surface}] failed to load ${loader}`, error);
    return fallback;
  }
}
