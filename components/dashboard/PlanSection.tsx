"use client";

import Icon from "@/components/Icon";
import UpgradeButton from "@/components/dashboard/UpgradeButton";
import type { WorkspaceBillingState } from "@/components/dashboard/billing";

function formatDate(iso: string | null): string {
  if (!iso) return "the end of the period";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "the end of the period";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Settings plan card. Trial users see usage + upgrade; Pro users see status
 * and a manage/cancel entry to the Dodo customer portal. Cancel keeps access
 * until the period end (state reflected here once the webhook lands).
 */
export default function PlanSection({
  billing,
}: {
  billing: WorkspaceBillingState | null;
}) {
  if (!billing) {
    return (
      <div className="section-note flex items-start gap-3">
        <span className="brief-note-icon shrink-0">
          <Icon name="warning" size={18} />
        </span>
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            Plan status unavailable
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-3)]">
            Refresh this page before changing your subscription.
          </p>
        </div>
      </div>
    );
  }

  const isPro = billing.tier === "pro";
  const legacyPro = billing.source === "legacy_override";
  const usedPct = billing.credits_total
    ? Math.min(
        100,
        Math.round(
          ((billing.credits_total - billing.credits_remaining) /
            billing.credits_total) *
            100,
        ),
      )
    : 0;

  return (
    <div className="section-note grid gap-4">
      <div className="flex items-start gap-3">
        <span className="brief-note-icon shrink-0">
          <Icon name={isPro ? "verified" : "bolt"} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              {isPro ? "Pro plan" : "Trial plan"}
            </p>
            <span
              className={
                "rounded-full px-2 py-0.5 text-[11px] font-medium " +
                (billing.frozen
                  ? "bg-rose-100 text-rose-800"
                  : isPro
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]")
              }
            >
              {billing.frozen
                ? "Sending paused"
                : isPro
                  ? billing.canceled
                    ? `Cancels ${formatDate(billing.renews_at)}`
                    : legacyPro
                      ? "Legacy access"
                      : "Active"
                  : `${billing.credits_remaining} / ${billing.credits_total} credits`}
            </span>
          </div>

          {isPro ? (
            <p className="mt-1 text-sm leading-6 text-[var(--color-text-3)]">
              {legacyPro
                ? "Grandfathered Pro access is active. No paid subscription is attached, so there is nothing to cancel."
                : billing.canceled
                ? `Unlimited sending stays on until ${formatDate(billing.renews_at)}. After that, outreach pauses until you resubscribe.`
                : `Unlimited sending. Renews ${formatDate(billing.renews_at)}.`}
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm leading-6 text-[var(--color-text-3)]">
                {billing.frozen
                  ? "Trial credits are used up — sending is paused. Upgrade to Pro for unlimited sending; held messages resume instantly."
                  : "Each email or LinkedIn message uses one credit. Upgrade to Pro for unlimited sending."}
              </p>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-ink-2)]">
                <div
                  className={
                    "h-full rounded-full " +
                    (billing.frozen
                      ? "bg-rose-400"
                      : "bg-[var(--color-cta-bg)]")
                  }
                  style={{ width: `${usedPct}%` }}
                />
              </div>
            </>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {isPro && billing.portal_available ? (
              <UpgradeButton
                endpoint="/api/billing/portal"
                label="Manage / cancel subscription"
                pendingLabel="Opening portal..."
                icon="settings"
                variant="quiet"
              />
            ) : isPro ? null : (
              <UpgradeButton
                endpoint="/api/billing/pro/checkout"
                label="Upgrade to Pro"
                icon="bolt"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
