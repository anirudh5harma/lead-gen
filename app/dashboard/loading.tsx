export default function DashboardLoading() {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar skeleton */}
      <div className="w-60 shrink-0 border-r border-[var(--color-line-1)] bg-[var(--color-ink-2)] hidden md:flex flex-col gap-3 p-4">
        <div className="h-8 w-28 rounded-lg bg-[var(--color-line-1)] animate-pulse mb-4" />
        {[1, 2, 3].map(i => (
          <div key={i} className="h-9 rounded-lg bg-[var(--color-line-1)] animate-pulse" />
        ))}
      </div>

      <div className="flex-1 min-w-0 flex flex-col bg-[var(--color-ink-1)]">
        {/* Header skeleton */}
        <div className="h-16 border-b border-[var(--color-line-1)] flex items-center px-6 gap-4">
          <div className="h-4 w-32 rounded bg-[var(--color-line-1)] animate-pulse" />
          <div className="ml-auto h-8 w-8 rounded-full bg-[var(--color-line-1)] animate-pulse" />
        </div>

        {/* Feed skeleton */}
        <main className="flex-1 px-6 py-6">
          <div className="max-w-6xl mx-auto space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="card p-5 flex items-center gap-4 animate-pulse">
                <div className="w-8 h-8 rounded-full bg-[var(--color-line-1)] shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-48 rounded bg-[var(--color-line-1)]" />
                  <div className="h-3 w-72 rounded bg-[var(--color-line-1)]" />
                </div>
                <div className="h-7 w-20 rounded-full bg-[var(--color-line-1)]" />
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}
