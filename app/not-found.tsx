import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-24">
      <div className="max-w-md text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-3)] mb-4">
          404
        </p>
        <h1 className="font-serif text-4xl text-[var(--color-text-1)] mb-4">
          Not found
        </h1>
        <p className="font-sans text-[var(--color-text-2)] mb-8">
          The page you are looking for does not exist.
        </p>
        <Link
          href="/"
          className="font-mono text-[12px] uppercase tracking-[0.16em] text-[var(--color-accent)] underline underline-offset-4"
        >
          Return home
        </Link>
      </div>
    </main>
  );
}
