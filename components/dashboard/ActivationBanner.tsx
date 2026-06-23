"use client";

import Link from "next/link";
import Icon from "@/components/Icon";
import type { WorkspaceActivationState } from "@/core/product/activation-state.ts";

export default function ActivationBanner({
  activation,
}: {
  activation: WorkspaceActivationState | null;
}) {
  if (!activation || activation.product_ready) return null;

  const detail = activation.website_set
    ? "Add a company description in Profile before the Agent can activate and send outreach."
    : "Add your company website in Profile. We need the website plus a company description before the Agent can activate and send outreach.";
  const cta = activation.website_set ? "Add description" : "Add website";

  return (
    <div
      role="status"
      className="mb-5 flex flex-col gap-3 rounded-[14px] border border-sky-200/90 bg-sky-50/90 px-4 py-3.5 text-sky-950 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-white/70">
          <Icon name="language" size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold tracking-[-0.01em]">
            Add your company website to activate the product
          </p>
          <p className="mt-0.5 text-[12.5px] leading-[1.5] opacity-80">
            {detail}
          </p>
        </div>
      </div>
      <Link href="/dashboard/profile#profile" className="btn-solid-sm shrink-0 sm:ml-3">
        <Icon name="language" size={14} />
        {cta}
      </Link>
    </div>
  );
}
