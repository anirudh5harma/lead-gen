"use client";

import Icon from "@/components/Icon";
import UpgradeButton from "@/components/dashboard/UpgradeButton";
import {
  TRIAL_LOW_THRESHOLD,
  type WorkspaceBillingState,
} from "@/components/dashboard/billing";

/**
 * Non-blocking dashboard nudge. Shows a hard freeze banner when trial credits
 * are exhausted and the workspace isn't Pro-entitled, a softer low-credit nudge
 * near the end of trial, and nothing once on Pro. Never a modal lock — the
 * pipeline keeps running, only sending is held.
 */
export default function BillingBanner({
  billing,
}: {
  billing: WorkspaceBillingState | null;
}) {
  if (!billing) return null;

  // Pro and healthy — no nudge (Plan section in Profile handles management).
  if (billing.tier === "pro" && !billing.frozen) return null;

  const frozen = billing.frozen;
  const low =
    !frozen &&
    billing.tier === "trial" &&
    billing.credits_remaining <= TRIAL_LOW_THRESHOLD;

  if (!frozen && !low) return null;

  const tone = frozen
    ? "border-rose-200/90 bg-rose-50/90 text-rose-950"
    : "border-amber-200/90 bg-amber-50/90 text-amber-950";

  return (
    <div
      role="status"
      className={`mb-5 flex flex-col gap-3 rounded-[14px] border px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between ${tone}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-white/70">
          <Icon name={frozen ? "lock" : "bolt"} size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold tracking-[-0.01em]">
            {frozen
              ? "Outreach is paused — trial credits used up"
              : `${billing.credits_remaining} of ${billing.credits_total} trial credits left`}
          </p>
          <p className="mt-0.5 text-[12.5px] leading-[1.5] opacity-80">
            {frozen
              ? "Your signals, drafts, and prep keep running. Upgrade to Pro to resume sending instantly — no work is lost."
              : "Each send uses one credit. Upgrade to Pro for unlimited sending before you run out."}
          </p>
        </div>
      </div>
      <div className="shrink-0 sm:pl-3">
        <UpgradeButton
          endpoint="/api/billing/pro/checkout"
          label="Upgrade to Pro"
          icon="bolt"
        />
      </div>
    </div>
  );
}
