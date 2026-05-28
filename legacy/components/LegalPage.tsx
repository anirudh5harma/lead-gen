import Link from 'next/link'
import Image from 'next/image'

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

/**
 * Editorial legal page — matches the design system used across /, /docs, /pricing.
 * Numbered sections, hairline dividers, mono labels, single coral accent.
 */
export function LegalPage({ eyebrow, title, intro, updatedAt, sections }: LegalPageProps) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-ink-1)]">
      <Nav />

      <main className="flex-1">
        {/* Hero */}
        <section className="max-w-3xl mx-auto px-6 pt-20 md:pt-28 pb-12">
          <div className="flex items-center gap-3 mb-8">
            <span className="section-num">00</span>
            <span className="h-px w-10 bg-[var(--color-line-2)]" />
            <span className="mono">{eyebrow}</span>
          </div>
          <h1 className="editorial-h2">{title}</h1>
          <p className="text-[15px] text-[var(--color-text-2)] mt-6 leading-relaxed">{intro}</p>
          <p className="mono mt-6">Last updated · {updatedAt}</p>
        </section>

        {/* Sections */}
        <section className="max-w-3xl mx-auto px-6 pb-24">
          <div className="border-t border-[var(--color-line-1)]">
            {sections.map((s, i) => (
              <article key={s.title} className="py-10 border-b border-[var(--color-line-1)] grid grid-cols-[60px_1fr] gap-6">
                <div className="mono pt-1">{String(i + 1).padStart(2, '0')}</div>
                <div>
                  <h2 className="text-[18px] font-medium tracking-tight mb-4">{s.title}</h2>
                  {s.paragraphs?.map((p) => (
                    <p key={p} className="text-[14px] leading-[1.7] text-[var(--color-text-2)] mb-3 last:mb-0">{p}</p>
                  ))}
                  {s.items && (
                    <ul className="mt-4 space-y-2.5">
                      {s.items.map((it) => (
                        <li key={it} className="grid grid-cols-[18px_1fr] gap-2 text-[14px] leading-[1.65] text-[var(--color-text-2)]">
                          <span className="text-[var(--color-accent)] pt-[3px]">◆</span>
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
      </main>

      <Footer />
    </div>
  )
}

function Nav() {
  return (
    <nav className="sticky top-0 z-30 border-b border-[var(--color-line-1)] bg-[var(--color-ink-1)]/85 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto h-14 px-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo.svg" alt="Bombsell" width={22} height={22} />
          <span className="text-[14px] font-semibold tracking-tight">Bombsell</span>
        </Link>
        <div className="flex items-center gap-7">
          <Link href="/#loop" className="hidden md:block text-[13px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)]">How it works</Link>
          <Link href="/#agents" className="hidden md:block text-[13px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)]">For agents</Link>
          <Link href="/pricing" className="hidden md:block text-[13px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)]">Pricing</Link>
          <Link href="/api/docs/agents" className="hidden md:block text-[13px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)]">Docs</Link>
          <Link href="/" className="btn-primary h-8 px-4 text-[13px] inline-flex items-center">Start free</Link>
        </div>
      </div>
    </nav>
  )
}

function Footer() {
  return (
    <footer className="border-t border-[var(--color-line-1)] py-10">
      <div className="max-w-6xl mx-auto px-6 flex flex-wrap gap-x-6 gap-y-2 items-center justify-between text-[12px] text-[var(--color-text-4)]">
        <span>© {new Date().getFullYear()} Bombsell</span>
        <div className="flex items-center gap-5">
          <Link href="/privacy" className="hover:text-[var(--color-text-2)]">Privacy</Link>
          <Link href="/terms" className="hover:text-[var(--color-text-2)]">Terms</Link>
          <a href="mailto:team@bombsell.com" className="hover:text-[var(--color-text-2)]">team@bombsell.com</a>
        </div>
      </div>
    </footer>
  )
}
