"use client";

import Link from "next/link";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import type { WorkspaceActivationState } from "@/core/product/activation-state.ts";
import { retryActivationSetupAction } from "@/app/dashboard/actions";

export default function ActivationBanner({
  activation,
}: {
  activation: WorkspaceActivationState | null;
}) {
  const setupStatus = activation?.setup_status ?? "idle";
  if (!activation || (activation.product_ready && setupStatus === "idle")) return null;

  const content = setupStatus === "running"
    ? {
        title: "Agent launch is in progress",
        detail:
          "Bombsell is building your Profile, Plays, and first Signal sources. You can connect channels while setup finishes.",
        cta: "View Profile",
        icon: "progress_activity",
      }
    : setupStatus === "failed"
      ? {
          title: "Agent launch needs attention",
          detail:
            "Your workspace is safe, but Profile setup did not finish. Review the company details and launch it again.",
          cta: "Review Profile",
          icon: "error",
        }
      : {
          title: "Add your company website to activate the product",
          detail: activation.website_set
            ? "Add a company description in Profile before the Agent can activate and send outreach."
            : "Add your company website in Profile. We need the website plus a company description before the Agent can activate and send outreach.",
          cta: activation.website_set ? "Add description" : "Add website",
          icon: "language",
        };

  return (
    <div
      role="status"
      className="mb-5 flex flex-col gap-3 rounded-[14px] border border-sky-200/90 bg-sky-50/90 px-4 py-3.5 text-sky-950 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-white/70">
          <Icon name={content.icon} size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold tracking-[-0.01em]">
            {content.title}
          </p>
          <p className="mt-0.5 text-[12.5px] leading-[1.5] opacity-80">
            {content.detail}
          </p>
        </div>
      </div>
      {setupStatus === "failed" && activation.setup_run_id ? (
        <form action={retryActivationSetupAction} className="shrink-0 sm:ml-3">
          <input type="hidden" name="workflow_run_id" value={activation.setup_run_id} />
          <input type="hidden" name="return_to" value="/dashboard/profile#profile" />
          <PendingSubmitButton
            className="btn-solid-sm"
            pendingLabel="Retrying launch"
          >
            <Icon name="refresh" size={14} />
            Retry launch
          </PendingSubmitButton>
        </form>
      ) : (
        <Link href="/dashboard/profile#profile" className="btn-solid-sm shrink-0 sm:ml-3">
          <Icon name={content.icon} size={14} />
          {content.cta}
        </Link>
      )}
    </div>
  );
}
