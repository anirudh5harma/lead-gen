export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[var(--color-ink-1)] relative overflow-hidden">
      <div aria-hidden className="pointer-events-none fixed inset-0 dot-grid opacity-50" />
      <div className="relative text-center space-y-5 max-w-sm fade-in">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-4)] font-mono">404</p>
        <div className="space-y-2">
          <h1 className="text-2xl font-medium tracking-tight text-[var(--color-text-1)]">Page not found</h1>
          <p className="text-xs text-[var(--color-text-3)] leading-relaxed">
            This page doesn&rsquo;t exist or was moved.
          </p>
        </div>
        <div className="flex items-center justify-center gap-3 pt-2">
          <a
            href="/dashboard"
            className="h-9 px-4 rounded-full btn-primary text-xs inline-flex items-center"
          >
            Go to dashboard
          </a>
          <a
            href="/"
            className="h-9 px-4 rounded-full btn-ghost text-xs inline-flex items-center"
          >
            Home
          </a>
        </div>
      </div>
    </div>
  )
}
