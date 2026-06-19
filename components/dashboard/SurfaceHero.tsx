import type { ReactNode } from "react";

export function SurfaceHero({
  kicker,
  title,
  description,
  meta,
}: {
  kicker: string;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-[14px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] md:p-7">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">
        {kicker}
      </p>
      <h1
        className="mt-5 text-[clamp(2rem,4.4vw,3.6rem)] font-semibold text-[var(--color-text-1)]"
        style={{ fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.05, fontFamily: "var(--font-display)" }}
      >
        {title}
      </h1>
      {description ? (
        <p className="mt-5 max-w-[64ch] text-[15px] leading-[1.7] text-[var(--color-text-2)]">
          {description}
        </p>
      ) : null}
      {meta ? <div className="mt-6">{meta}</div> : null}
    </section>
  );
}

export function SurfaceSection({
  title,
  action,
  children,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-10">
      {title || action ? (
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--color-line-1)] pb-3">
          {title ? (
            <h2
              className="text-[15px] font-semibold text-[var(--color-text-1)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {title}
            </h2>
          ) : <span />}
          {action ? <div>{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function HeroStat({ label, value }: { label: string; value: number | string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-[8px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] px-3 py-1">
      <strong className="text-[13px] font-semibold tabular-nums text-[var(--color-text-1)]">{value}</strong>
      <span className="text-[11.5px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">{label}</span>
    </span>
  );
}
