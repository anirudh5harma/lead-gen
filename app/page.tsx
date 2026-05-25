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
        <Link
          href="/dashboard"
          className="inline-block font-mono text-[12px] uppercase tracking-[0.18em] px-5 py-3 rounded bg-[var(--color-accent)] text-[var(--color-accent-on)] hover:bg-[var(--color-accent-hi)]"
        >
          Open the dashboard
        </Link>
      </div>
    </main>
  );
}
