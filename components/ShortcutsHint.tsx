'use client'

export default function ShortcutsHint() {
  const shortcuts: { keys: string[]; label: string }[] = [
    { keys: ['J', 'K'], label: 'Navigate' },
    { keys: ['D'],      label: 'Draft' },
    { keys: ['S'],      label: 'Sent' },
    { keys: ['B'],      label: 'Booked' },
    { keys: ['Esc'],    label: 'Close' },
  ]

  return (
    <div
      className="
        hidden md:flex fixed bottom-0 left-0 right-0 z-40
        items-center justify-center gap-5 px-6 py-2
        border-t border-[var(--color-line-1)]
        bg-[var(--color-ink-1)]/85 backdrop-blur-md
        text-[11px] text-[var(--color-text-3)]
        opacity-60 hover:opacity-100 transition-opacity
      "
      aria-label="Keyboard shortcuts"
    >
      {shortcuts.map((s, i) => (
        <span key={s.label} className="flex items-center gap-1.5">
          <span className="flex items-center gap-0.5">
            {s.keys.map((k) => (
              <kbd key={k} className="kbd">{k}</kbd>
            ))}
          </span>
          <span>{s.label}</span>
          {i < shortcuts.length - 1 && (
            <span className="text-[var(--color-text-4)] ml-3">·</span>
          )}
        </span>
      ))}
    </div>
  )
}
