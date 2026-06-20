"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import Icon from "@/components/Icon";

type FitFeedbackButtonProps = {
  children: ReactNode;
  icon: string;
  active: boolean;
  detail: string;
};

export default function FitFeedbackButton({
  children,
  icon,
  active,
  detail,
}: FitFeedbackButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className={
        "flex w-full items-center justify-between gap-3 rounded-[8px] border px-3 py-2 text-left transition-colors disabled:cursor-wait disabled:opacity-70 " +
        (active
          ? "border-[var(--color-accent)] bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
          : "border-[var(--color-line-1)] bg-[var(--color-ink-0)] text-[var(--color-text-2)] hover:border-[var(--color-line-3)]")
      }
    >
      <span className="flex min-w-0 items-center gap-2">
        {pending ? (
          <span className="pending-submit-spinner shrink-0" aria-hidden="true" />
        ) : (
          <Icon name={icon} size={14} />
        )}
        <span className="truncate text-sm font-semibold">{children}</span>
      </span>
      <span className="text-xs text-[var(--color-text-3)]">
        {pending ? "Saving..." : detail}
      </span>
    </button>
  );
}
