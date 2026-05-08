'use client'

export interface OperatingSignalItem {
  id: string
  label: string
  detail: string
}

export interface OperatingActionItem {
  id: string
  label: string
  reason: string
  href: string
}

export function OperatingModelPanels({
  working,
  notWorking,
  actions,
  workingTitle = 'Working',
  notWorkingTitle = 'Not Working',
  actionTitle = 'Action Queue',
  workingEmptyText = 'No reliable wins yet.',
  notWorkingEmptyText = 'No major blockers detected.',
  actionEmptyText = 'No immediate action required.',
}: {
  working: OperatingSignalItem[]
  notWorking: OperatingSignalItem[]
  actions: OperatingActionItem[]
  workingTitle?: string
  notWorkingTitle?: string
  actionTitle?: string
  workingEmptyText?: string
  notWorkingEmptyText?: string
  actionEmptyText?: string
}) {
  return (
    <section className="grid gap-3 lg:grid-cols-3">
      <SignalPanel title={workingTitle} tone="positive" items={working} emptyText={workingEmptyText} />
      <SignalPanel title={notWorkingTitle} tone="negative" items={notWorking} emptyText={notWorkingEmptyText} />
      <ActionPanel title={actionTitle} actions={actions} emptyText={actionEmptyText} />
    </section>
  )
}

function SignalPanel({
  title,
  tone,
  items,
  emptyText,
}: {
  title: string
  tone: 'positive' | 'negative'
  items: OperatingSignalItem[]
  emptyText: string
}) {
  const border = tone === 'positive' ? 'border-[var(--color-sig-expansion)]/30' : 'border-[var(--color-sig-regulation)]/28'
  const badge = tone === 'positive' ? 'bg-[var(--color-sig-expansion-bg)] text-[var(--color-sig-expansion)]' : 'bg-[var(--color-sig-regulation)]/12 text-[var(--color-sig-regulation)]'

  return (
    <section className={`rounded-lg border ${border} bg-white px-4 py-4`}>
      <h3 className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge}`}>{title}</h3>
      <div className="mt-2 space-y-2">
        {items.length > 0 ? items.map(item => (
          <div key={item.id} className="rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2">
            <p className="text-[12px] font-semibold text-[var(--color-text-1)]">{item.label}</p>
            <p className="mt-0.5 text-[11px] text-[var(--color-text-4)]">{item.detail}</p>
          </div>
        )) : (
          <p className="text-[11px] text-[var(--color-text-4)]">{emptyText}</p>
        )}
      </div>
    </section>
  )
}

function ActionPanel({
  title,
  actions,
  emptyText,
}: {
  title: string
  actions: OperatingActionItem[]
  emptyText: string
}) {
  return (
    <section className="rounded-lg border border-[var(--color-line-1)] bg-white px-4 py-4">
      <h3 className="inline-flex rounded-full bg-[var(--color-accent-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-accent-ring)]">{title}</h3>
      <div className="mt-2 space-y-2">
        {actions.length > 0 ? actions.map(action => (
          <a
            key={action.id}
            href={action.href}
            className="block rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2 hover:border-[var(--color-accent)]/35"
          >
            <p className="text-[12px] font-semibold text-[var(--color-text-1)]">{action.label}</p>
            <p className="mt-0.5 text-[11px] text-[var(--color-text-4)]">{action.reason}</p>
          </a>
        )) : (
          <p className="text-[11px] text-[var(--color-text-4)]">{emptyText}</p>
        )}
      </div>
    </section>
  )
}
