const PAYMENT_PERIOD_START_KEYS = [
  'payment_date',
  'paid_at',
  'current_period_start',
  'billing_period_start',
  'period_start',
  'created_at',
  'created',
] as const

function coerceDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value
    const date = new Date(milliseconds)
    return Number.isNaN(date.getTime()) ? null : date
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const numeric = Number(trimmed)
    const date = Number.isFinite(numeric)
      ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
      : new Date(trimmed)
    return Number.isNaN(date.getTime()) ? null : date
  }

  return null
}

export function resolveBillingPeriodStart(
  payload: Record<string, unknown>,
  fallback: Date = new Date(),
): string {
  for (const key of PAYMENT_PERIOD_START_KEYS) {
    const date = coerceDate(payload[key])
    if (date) return date.toISOString()
  }
  return fallback.toISOString()
}

function addCalendarMonthsUtc(date: Date, months: number): Date {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + months
  const day = date.getUTCDate()
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()

  return new Date(Date.UTC(
    year,
    month,
    Math.min(day, lastDayOfTargetMonth),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ))
}

export function isMonthlyGrantDue(
  lastGrantedAt: unknown,
  now: Date = new Date(),
): boolean {
  const lastGrant = coerceDate(lastGrantedAt)
  if (!lastGrant) return true
  return addCalendarMonthsUtc(lastGrant, 1).getTime() <= now.getTime()
}

export function isBillingPeriodStillActive(
  renewsAt: unknown,
  now: Date = new Date(),
): boolean {
  const renewalDate = coerceDate(renewsAt)
  return !renewalDate || renewalDate.getTime() > now.getTime()
}
