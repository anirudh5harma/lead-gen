"use client";

import Link from "next/link";
import Icon from "@/components/Icon";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="mx-auto grid max-w-2xl gap-6 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-6">
      <span className="grid size-10 place-items-center rounded-[8px] bg-[var(--color-neg-bg)] text-[var(--color-neg)]">
        <Icon name="error" size={19} />
      </span>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
          Dashboard
        </p>
        <h1
          className="mt-3 text-[24px] font-semibold text-[var(--color-text-1)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          This tab could not finish loading.
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--color-text-3)]">
          Try loading the tab again. The server error is still captured with its
          digest for debugging.
        </p>
        {error.digest ? (
          <p className="mt-3 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-2 font-mono text-xs text-[var(--color-text-3)]">
            digest: {error.digest}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={reset} className="btn-solid">
          <Icon name="refresh" size={16} />
          Retry
        </button>
        <Link href="/dashboard" className="btn-quiet">
          <Icon name="dashboard" size={16} />
          Dashboard
        </Link>
      </div>
    </section>
  );
}
