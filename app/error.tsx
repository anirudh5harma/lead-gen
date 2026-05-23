"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-24">
      <div className="max-w-md text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-3)] mb-4">
          error
        </p>
        <h1 className="font-serif text-4xl text-[var(--color-text-1)] mb-4">
          Something went wrong
        </h1>
        <button
          type="button"
          onClick={reset}
          className="font-mono text-[12px] uppercase tracking-[0.16em] text-[var(--color-accent)] underline underline-offset-4"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
