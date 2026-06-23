'use client'

import Image from 'next/image'
import Link from 'next/link'
import BrandIcon from '@/components/BrandIcon'
import { googleAuthPath, PRODUCT_HOME_PATH } from '@/lib/auth/next'
import { PendingNavLink } from '@/components/marketing/PendingCta'

export const FOUNDER_CALL_URL = 'https://cal.com/anirudh5harma/15min'
export const CONTACT_EMAIL = 'team@bombsell.com'

const NAV_LINKS: { label: string; href: string }[] = [
  { label: 'Product', href: '/#features' },
  { label: 'How it works', href: '/#how' },
  { label: 'Pricing', href: '/pricing' },
]

const FOOTER_LINKS: Record<string, { label: string; href: string; external?: boolean }[]> = {
  Product: [
    { label: 'Features', href: '/#features' },
    { label: 'How it works', href: '/#how' },
    { label: 'Pricing', href: '/pricing' },
  ],
  Company: [
    { label: 'Book a demo', href: FOUNDER_CALL_URL, external: true },
    { label: 'Contact', href: `mailto:${CONTACT_EMAIL}` },
  ],
  Legal: [
    { label: 'Privacy', href: '/privacy' },
    { label: 'Terms', href: '/terms' },
  ],
}

/**
 * Shared marketing top nav — Ploy floating pill-rail pattern.
 * Used across landing, pricing, and legal pages so the public surface
 * stays perfectly in sync.
 */
export function MarketingNav() {
  return (
    <header className="fixed left-0 right-0 top-0 z-50 px-4 pt-4 md:px-6">
      <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-4">
        <Link
          href="/"
          className="inline-flex h-12 items-center gap-2 rounded-full bg-[var(--color-ink-0)]/85 px-4 text-[15px] font-semibold tracking-[-0.02em] text-[var(--color-text-1)] backdrop-blur-md ring-1 ring-[var(--color-line-1)] transition-colors hover:bg-[var(--color-ink-0)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          <Image src="/logo.svg" alt="" width={22} height={22} priority unoptimized className="size-[22px]" />
          Bombsell
        </Link>

        <nav className="hidden h-12 items-center gap-1 rounded-full bg-[var(--color-ink-0)]/85 px-2 text-[13.5px] font-medium tracking-[-0.01em] text-[var(--color-text-2)] backdrop-blur-md ring-1 ring-[var(--color-line-1)] min-[960px]:inline-flex">
          {NAV_LINKS.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="inline-flex h-9 items-center rounded-full px-3.5 transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-text-1)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <PendingNavLink
            href={googleAuthPath(PRODUCT_HOME_PATH)}
            leading={<BrandIcon name="google" size={14} />}
            className="inline-flex h-12 items-center gap-1.5 rounded-full bg-[var(--color-ink-0)]/85 px-5 text-[13.5px] font-semibold tracking-[-0.01em] text-[var(--color-text-1)] backdrop-blur-md ring-1 ring-[var(--color-line-1)] transition-colors hover:bg-[var(--color-ink-0)]"
          >
            Log in
          </PendingNavLink>
          <PendingNavLink
            href="/auth/start"
            className="hidden h-12 items-center gap-1.5 rounded-full bg-[var(--color-cta-bg)] px-5 text-[13.5px] font-semibold tracking-[-0.01em] text-[var(--color-cta-text)] transition-transform hover:bg-[var(--color-cta-hover)] active:scale-[0.98] sm:inline-flex"
          >
            Start free
          </PendingNavLink>
        </div>
      </div>
    </header>
  )
}

/**
 * Shared marketing footer. Every link here resolves to a real
 * destination — internal route, mailto, or the founder call URL.
 */
export function MarketingFooter() {
  return (
    <footer className="relative border-t border-[var(--color-line-1)] bg-[var(--color-ink-0)]">
      <div className="mx-auto w-full max-w-[1280px] px-4 py-16 md:px-8 lg:px-12">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-5">
          <div className="col-span-2">
            <div
              className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--color-text-1)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              <Image src="/logo.svg" alt="" width={24} height={24} unoptimized className="size-6" />
              Bombsell
            </div>
            <p className="mt-4 max-w-[280px] text-[13.5px] leading-[1.6] tracking-[-0.01em] text-[var(--color-text-3)]">
              Signal-led outbound for modern GTM teams. Quality signals, verified contacts, agent outreach with proof.
            </p>
          </div>
          {Object.entries(FOOTER_LINKS).map(([category, links]) => (
            <div key={category}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-1)]">
                {category}
              </p>
              <ul className="mt-4 grid gap-2.5">
                {links.map((link) =>
                  link.external ? (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13.5px] tracking-[-0.01em] text-[var(--color-text-3)] transition-colors hover:text-[var(--color-text-1)]"
                      >
                        {link.label}
                      </a>
                    </li>
                  ) : link.href.startsWith('mailto:') ? (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="text-[13.5px] tracking-[-0.01em] text-[var(--color-text-3)] transition-colors hover:text-[var(--color-text-1)]"
                      >
                        {link.label}
                      </a>
                    </li>
                  ) : (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-[13.5px] tracking-[-0.01em] text-[var(--color-text-3)] transition-colors hover:text-[var(--color-text-1)]"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-[var(--color-line-1)] pt-6 md:flex-row">
          <p className="text-[12px] text-[var(--color-text-3)]">
            &copy; {new Date().getFullYear()} Bombsell. All rights reserved.
          </p>
          <div className="flex items-center gap-3">
            <a
              href="https://x.com/TeamBombsell"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="X"
              className="grid size-9 place-items-center rounded-full bg-[var(--color-ink-1)] text-[var(--color-text-3)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-text-1)]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
