import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[var(--color-ink-1)]">
      <div className="text-center max-w-sm">
        <p className="mono mb-6 text-[var(--color-accent)]">404 · not found</p>
        <h1 className="editorial-h2">
          Page <span className="serif-italic text-[var(--color-accent)]">missing.</span>
        </h1>
        <p className="text-[14px] text-[var(--color-text-3)] mt-4 leading-relaxed">
          This page doesn&rsquo;t exist or was moved.
        </p>
        <div className="mt-8 flex items-center justify-center gap-2">
          <Link href="/dashboard" className="btn-accent h-10 px-5 text-[13px] inline-flex items-center">
            Go to dashboard →
          </Link>
          <Link href="/" className="btn-ghost h-10 px-5 text-[13px] inline-flex items-center">
            Home
          </Link>
        </div>
      </div>
    </div>
  )
}
