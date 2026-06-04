export default function DashboardLoading() {
  return (
    <div className="space-y-12">
      <section className="border-b border-[color:var(--color-line-2)] pb-10">
        <div className="h-[11px] w-32 animate-pulse rounded bg-[var(--color-ink-2)]" />
        <div className="mt-6 h-12 w-3/4 animate-pulse rounded bg-[var(--color-ink-2)]" />
        <div className="mt-3 h-12 w-2/3 animate-pulse rounded bg-[var(--color-ink-2)]" />
        <div className="mt-6 h-4 w-1/2 animate-pulse rounded bg-[var(--color-ink-2)]" />
      </section>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[148px] animate-pulse rounded-lg border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)]"
          />
        ))}
      </section>
    </div>
  );
}
