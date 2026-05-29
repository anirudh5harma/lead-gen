import Link from "next/link";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-24">
      <div className="max-w-2xl text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-3)] mb-6">
          pivot-v2 · foundation
        </p>
        <h1 className="font-serif text-5xl md:text-6xl text-[var(--color-text-1)] leading-[1.05] mb-6">
          AI-native GTM infrastructure
        </h1>
        <p className="font-sans text-lg text-[var(--color-text-2)] leading-relaxed mb-10">
          Reps, Signals, Plays, Conversations, Outcomes. Durable workflows, a
          typed event bus, an explicit knowledge graph. Outbound, content, and
          campaigns on autopilot — reliably.
        </p>
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/login?next=/onboarding"
            className="inline-block rounded bg-[var(--color-accent)] px-5 py-3 font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--color-accent-on)] hover:bg-[var(--color-accent-hi)]"
          >
            Start with Google
          </Link>
          <Link
            href="/dashboard"
            className="inline-block rounded border border-[var(--color-line-1)] px-5 py-3 font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--color-text-2)] hover:text-[var(--color-text-1)]"
          >
            Open dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
