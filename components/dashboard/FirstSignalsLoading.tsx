"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";

export default function FirstSignalsLoading({
  workspaceName,
}: {
  workspaceName: string;
}) {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.refresh();
    }, 15000);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <section className="relative overflow-hidden rounded-[12px] border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-2 rounded-full bg-black px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em]"
            style={{ color: "var(--color-brand-green-bright)" }}
          >
            <span
              className="inline-block size-2 animate-spin rounded-full border border-current border-t-transparent"
              aria-hidden="true"
            />
            Pulling sources
          </span>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">
            Welcome, {workspaceName}
          </p>
        </div>
        <h1
          className="mt-5 max-w-full break-words text-[2rem] font-semibold leading-tight text-[var(--color-text-1)] [overflow-wrap:anywhere] sm:text-[3rem]"
          style={{ fontFamily: "var(--font-display)", letterSpacing: 0 }}
        >
          Your first signals are arriving.
        </h1>
        <p className="mt-3 max-w-[72ch] break-words text-[15px] leading-7 text-[var(--color-text-2)] [overflow-wrap:anywhere]">
          Bombsell is reading your site, building positioning, and pulling the
          first batch of qualified signals from public sources. Usually under
          30 seconds.
        </p>
        <div className="mt-6 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-[var(--color-ink-2)]">
          <span className="dashboard-loader-bar" />
        </div>
        <div className="mt-3 flex items-center gap-2 text-[12px] text-[var(--color-text-3)]">
          <Icon name="auto_awesome" size={12} />
          <span>This page refreshes automatically.</span>
        </div>
      </section>

      <section className="grid gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="dashboard-loader-skeleton h-24" />
        ))}
      </section>
    </div>
  );
}
