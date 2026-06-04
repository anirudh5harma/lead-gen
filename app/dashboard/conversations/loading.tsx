export default function Loading() {
  return (
    <div className="space-y-8">
      <section className="border-b border-[color:var(--color-line-2)] pb-10">
        <div className="h-[11px] w-40 animate-pulse rounded bg-[var(--color-ink-2)]" />
        <div className="mt-6 h-10 w-2/3 animate-pulse rounded bg-[var(--color-ink-2)]" />
        <div className="mt-4 h-4 w-1/2 animate-pulse rounded bg-[var(--color-ink-2)]" />
      </section>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)]" />
        ))}
      </div>
    </div>
  );
}
