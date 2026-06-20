import { MarketingFooter, MarketingNav } from '@/components/marketing/MarketingChrome'

type LegalSection = {
  title: string
  paragraphs?: string[]
  items?: string[]
}

export type LegalPageProps = {
  eyebrow: string
  title: string
  intro: string
  updatedAt: string
  sections: LegalSection[]
}

/**
 * Ploy-styled legal page — hairline dividers, numbered sections, mono labels.
 * Shares the marketing nav + footer so the public surface stays in sync.
 */
export function LegalPage({ eyebrow, title, intro, updatedAt, sections }: LegalPageProps) {
  return (
    <main className="relative isolate flex min-h-[100dvh] flex-col bg-[var(--color-ink-1)] text-[var(--color-text-1)]">
      <MarketingNav />

      <div className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-3xl px-4 pb-12 pt-28 md:px-8 md:pt-36">
          <div className="mb-8 flex items-center gap-3">
            <span className="section-num">00</span>
            <span className="h-px w-10 bg-[var(--color-line-2)]" />
            <span className="mono">{eyebrow}</span>
          </div>
          <h1
            className="text-[clamp(2rem,5vw,3.25rem)] font-bold leading-[1.04] tracking-[-0.03em]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {title}
          </h1>
          <p className="mt-6 text-[15.5px] leading-[1.7] tracking-[-0.01em] text-[var(--color-text-2)]">
            {intro}
          </p>
          <p className="mono mt-6">Last updated · {updatedAt}</p>
        </section>

        {/* Sections */}
        <section className="mx-auto max-w-3xl px-4 pb-24 md:px-8">
          <div className="border-t border-[var(--color-line-1)]">
            {sections.map((s, i) => (
              <article
                key={s.title}
                className="grid grid-cols-[44px_1fr] gap-5 border-b border-[var(--color-line-1)] py-10 md:grid-cols-[60px_1fr] md:gap-6"
              >
                <div className="mono pt-1">{String(i + 1).padStart(2, '0')}</div>
                <div>
                  <h2 className="mb-4 text-[18px] font-semibold tracking-[-0.015em] text-[var(--color-text-1)]">
                    {s.title}
                  </h2>
                  {s.paragraphs?.map((p) => (
                    <p key={p} className="mb-3 text-[14.5px] leading-[1.7] tracking-[-0.01em] text-[var(--color-text-2)] last:mb-0">
                      {p}
                    </p>
                  ))}
                  {s.items && (
                    <ul className="mt-4 space-y-2.5">
                      {s.items.map((it) => (
                        <li
                          key={it}
                          className="grid grid-cols-[18px_1fr] gap-2 text-[14.5px] leading-[1.65] tracking-[-0.01em] text-[var(--color-text-2)]"
                        >
                          <span className="pt-[3px] text-[var(--color-accent)]">◆</span>
                          <span>{it}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      <MarketingFooter />
    </main>
  )
}
