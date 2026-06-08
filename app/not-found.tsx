import Link from "next/link";

export default function NotFound() {
  return (
    <main className="canvas-bg flex min-h-[100dvh] flex-1 flex-col items-center justify-center px-6 py-24">
      <section className="section-note w-full max-w-md text-center">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-3)]">
          404
        </p>
        <h1 className="mb-4 font-serif text-4xl text-[var(--color-text-1)]">
          Not found
        </h1>
        <p className="mb-8 font-sans text-[var(--color-text-2)]">
          The page you are looking for does not exist.
        </p>
        <Link
          href="/"
          className="inline-flex min-h-10 items-center justify-center rounded-[8px] bg-[var(--color-text-1)] px-4 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)]"
        >
          Return home
        </Link>
      </section>
    </main>
  );
}
