import Link from 'next/link'
import MarketingNavbar from './MarketingNavbar'

type LegalSection = {
  title: string
  paragraphs?: string[]
  items?: string[]
}

type LegalPageProps = {
  eyebrow: string
  title: string
  intro: string
  updatedAt: string
  sections: LegalSection[]
}

export function LegalPage({ eyebrow, title, intro, updatedAt, sections }: LegalPageProps) {
  return (
    <div className="min-h-screen bg-[var(--color-ink-1)]">
      <MarketingNavbar />

      <main className="mx-auto w-full max-w-5xl px-6 py-14 md:px-8 md:py-20">
        <div className="card overflow-hidden">
          <div className="border-b border-[var(--color-line-2)] bg-[linear-gradient(135deg,var(--color-ink-3),var(--color-ink-2))] px-7 py-8 md:px-10 md:py-10">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-accent)]">{eyebrow}</p>
            <h1 className="max-w-3xl text-4xl font-medium tracking-[-0.02em] text-[var(--color-text-1)] md:text-5xl">{title}</h1>
            <p className="mt-5 max-w-3xl text-[15px] leading-[1.7] text-[var(--color-text-2)]">{intro}</p>
            <p className="mt-5 text-[12px] text-[var(--color-text-4)]">Last updated: {updatedAt}</p>
          </div>

          <div className="space-y-10 bg-[#fffdf8] px-7 py-8 md:px-10 md:py-10">
            {sections.map(section => (
              <section key={section.title} className="space-y-4">
                <h2 className="text-[20px] font-medium tracking-tight text-[var(--color-text-1)]">{section.title}</h2>
                {section.paragraphs?.map(paragraph => (
                  <p key={paragraph} className="text-[14px] leading-[1.75] text-[var(--color-text-2)]">
                    {paragraph}
                  </p>
                ))}
                {section.items ? (
                  <ul className="space-y-2 text-[14px] leading-[1.7] text-[var(--color-text-2)]">
                    {section.items.map(item => (
                      <li key={item} className="flex gap-3">
                        <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-[var(--color-line-1)]">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-[12px] text-[var(--color-text-3)] md:px-8">
          <p>© {new Date().getFullYear()} Bombsell</p>
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="transition-colors hover:text-[var(--color-text-1)]">Privacy</Link>
            <Link href="/terms" className="transition-colors hover:text-[var(--color-text-1)]">Terms</Link>
            <a href="mailto:team@bombsell.com" className="transition-colors hover:text-[var(--color-text-1)]">team@bombsell.com</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
