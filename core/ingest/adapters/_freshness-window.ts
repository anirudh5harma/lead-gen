export function withinFreshnessWindow(
  freshnessAt: string | undefined,
  maxAgeDays: number,
  now: Date = new Date(),
): boolean {
  if (!freshnessAt) return true;
  const ms = Date.parse(freshnessAt);
  if (Number.isNaN(ms)) return true;
  return now.getTime() - ms <= maxAgeDays * 24 * 60 * 60 * 1000;
}

export function maxAgeDaysFromConfig(
  config: Record<string, unknown>,
  defaultDays: number,
): number {
  const raw = config.max_age_days;
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value <= 0) return defaultDays;
  return Math.min(Math.floor(value), 90);
}
