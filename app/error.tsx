"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="canvas-bg flex min-h-[100dvh] flex-1 flex-col items-center justify-center px-6 py-24">
      <section className="section-note w-full max-w-md text-center">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-3)]">
          error
        </p>
        <h1 className="mb-4 font-serif text-4xl text-[var(--color-text-1)]">
          Something went wrong
        </h1>
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-10 items-center justify-center rounded-[8px] bg-[var(--color-text-1)] px-4 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)]"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
