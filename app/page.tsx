'use client'

import Link from 'next/link'
import Icon from '@/components/Icon'
import ScrollReveal from '@/components/ui/ScrollReveal'
import { MarketingNav, MarketingFooter, FOUNDER_CALL_URL } from '@/components/marketing/MarketingChrome'
import { googleAuthPath } from '@/lib/auth/next'

// Real integrations Bombsell actually connects to — honest "works with",
// not borrowed-credibility "trusted by".
const INTEGRATIONS = [
  { name: 'Microsoft Outlook', slug: 'microsoftoutlook' },
  { name: 'Gmail', slug: 'gmail' },
  { name: 'LinkedIn', slug: 'linkedin' },
  { name: 'Slack', slug: 'slack' },
  { name: 'HubSpot', slug: 'hubspot' },
  { name: 'Supabase', slug: 'supabase' },
  { name: 'Resend', slug: 'resend' },
  { name: 'Anthropic', slug: 'anthropic' },
]

const FEATURES = [
  {
    title: 'Your buyer profile builds itself',
    description: 'Drop a URL. Bombsell reads your site, distills positioning, audience, and pitch — no manual list building.',
    icon: 'person',
    tone: 'pink',
  },
  {
    title: 'Quality signals, ranked by intent',
    description: 'Job posts, funding, product launches, inbound activity. Outreach starts from real timing evidence.',
    icon: 'sensors',
    tone: 'yellow',
  },
  {
    title: 'Verified contacts',
    description: 'Qualified signals become reachable people — verified email plus LinkedIn profile, never one without the other.',
    icon: 'account_tree',
    tone: 'green',
  },
  {
    title: 'Agent outreach with proof',
    description: 'The agent drafts, judges, and sends across email and LinkedIn. Every message inspectable. Every reply attributed.',
    icon: 'fact_check',
    tone: 'blue',
  },
]

const STACK = [
  { icon: 'edit', title: 'Copywriting', desc: 'Personalized at scale' },
  { icon: 'account_tree', title: 'Sequencing', desc: 'Adaptive multi-step plays' },
  { icon: 'sensors', title: 'Signals', desc: '15+ buying signals tracked' },
  { icon: 'travel_explore', title: 'Finder', desc: 'TAM graph + lookalikes' },
  { icon: 'verified', title: 'Verification', desc: 'Email + LinkedIn proof' },
  { icon: 'auto_graph', title: 'Learning', desc: 'Win patterns by week' },
]

const STEPS = [
  {
    number: '01',
    title: 'Enter your URL',
    description: 'Bombsell ingests your site. Builds positioning, ICP, voice, and a starter signal map in minutes.',
  },
  {
    number: '02',
    title: 'Your agent works',
    description: 'It detects buying signals, verifies contacts across email and LinkedIn, judges drafts before they send.',
  },
  {
    number: '03',
    title: 'Meetings land',
    description: 'You review proof, approve, and watch qualified replies show up in calendar. No spray, no chase.',
  },
]

const PROOF_SIGNALS = [
  { kind: 'Hiring SDRs', who: 'Linear', when: '2h', tone: 'pink' },
  { kind: 'Raised Series B', who: 'Glia', when: '4h', tone: 'green' },
  { kind: 'New CTO', who: 'Cresta', when: '6h', tone: 'yellow' },
  { kind: 'Website redesign', who: 'Sift', when: '1d', tone: 'blue' },
]

const TONE_BG: Record<string, string> = {
  pink: 'bg-[var(--color-brand-pink)] text-[#9a0103]',
  yellow: 'bg-[var(--color-brand-yellow)] text-[#441f16]',
  green: 'bg-[var(--color-brand-green)] text-[#273416]',
  blue: 'bg-[var(--color-brand-blue)] text-[#0a0d27]',
}

const TONE_DOT: Record<string, string> = {
  pink: 'bg-[var(--color-brand-pink)]',
  yellow: 'bg-[var(--color-brand-yellow)]',
  green: 'bg-[var(--color-brand-green-bright)]',
  blue: 'bg-[var(--color-brand-blue)]',
}

export default function Home() {
  return (
    <main className="relative isolate min-h-[100dvh] overflow-hidden bg-[var(--color-ink-1)] text-[var(--color-text-1)]">
      <HeroBackdrop />
      <MarketingNav />

      {/* HERO */}
      <section className="relative px-4 pt-28 pb-16 md:px-8 md:pt-32 md:pb-24 lg:px-12">
        <div className="mx-auto grid w-full max-w-[1280px] grid-cols-1 items-end gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div>
            <ScrollReveal delay={0.05}>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-cta-bg)] px-2.5 py-1 text-[12px] font-semibold leading-[1.4286] tracking-[-0.01em] text-[var(--color-brand-pink)]">
                <span className="size-1.5 rounded-full bg-[var(--color-brand-pink)]" />
                New · Agent v2 ships this week
              </span>
            </ScrollReveal>
            <ScrollReveal delay={0.15}>
              <h1
                className="mt-5 text-[clamp(2.75rem,6.2vw,5.75rem)] font-bold leading-[0.95] tracking-[-0.04em] text-[var(--color-text-1)]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Autonomous outbound,
                <br />
                <span className="text-[var(--color-text-2)]">for lean teams.</span>
              </h1>
            </ScrollReveal>
            <ScrollReveal delay={0.25}>
              <p className="mt-6 max-w-[520px] text-[18px] leading-[1.5] tracking-[-0.015em] text-[var(--color-text-2)]">
                Quality signals, verified contacts, and email or LinkedIn outreach in one agent that watches, drafts, judges, and sends.
              </p>
            </ScrollReveal>
            <ScrollReveal delay={0.35}>
              <form
                action="/auth/start"
                method="GET"
                className="mt-8 flex w-full max-w-[480px] flex-col gap-3 sm:flex-row sm:items-center"
              >
                <div className="relative flex-1">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]">
                    <Icon name="language" size={16} />
                  </div>
                  <input
                    type="text"
                    name="url"
                    placeholder="yourcompany.com"
                    required
                    pattern="[a-zA-Z0-9][a-zA-Z0-9\-_.]*\.[a-zA-Z]{2,}"
                    title="Enter a valid domain like yourcompany.com"
                    className="h-12 w-full rounded-full border border-[var(--color-input-border)] bg-[var(--color-ink-0)] pl-11 pr-4 text-[14px] tracking-[-0.01em] text-[var(--color-text-1)] outline-none transition-colors placeholder:text-[var(--color-text-3)] focus:border-[var(--color-text-1)]"
                  />
                </div>
                <button type="submit" className="btn-solid whitespace-nowrap">
                  Start free
                  <Icon name="arrow_forward" size={15} />
                </button>
              </form>
            </ScrollReveal>
            <ScrollReveal delay={0.45}>
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-[var(--color-text-3)]">
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="check" size={14} className="text-[var(--color-pos)]" />
                  Live in 5 minutes
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="check" size={14} className="text-[var(--color-pos)]" />
                  No credit card
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="check" size={14} className="text-[var(--color-pos)]" />
                  Cancel anytime
                </span>
              </div>
            </ScrollReveal>
          </div>

          <ScrollReveal delay={0.3}>
            <HeroPane />
          </ScrollReveal>
        </div>
      </section>

      {/* WORKS WITH — honest integrations, not fake social proof */}
      <section className="relative border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-10 md:px-8 lg:px-12">
          <p className="mb-6 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">
            Works with the tools you already use
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6 md:gap-x-14">
            {INTEGRATIONS.map((logo) => (
              <img
                key={logo.slug}
                src={`https://cdn.simpleicons.org/${logo.slug}/212121`}
                alt={logo.name}
                title={logo.name}
                width={22}
                height={22}
                className="h-[22px] w-auto opacity-50 grayscale transition-opacity hover:opacity-100"
              />
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="relative scroll-mt-24 border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-20 md:px-8 md:py-28 lg:px-12 lg:py-32">
          <ScrollReveal>
            <div className="max-w-[680px]">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">
                The stack
              </p>
              <h2
                className="mt-4 text-[clamp(2rem,4.4vw,3.5rem)] font-bold leading-[1.04] tracking-[-0.02em] text-[var(--color-text-1)]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Everything you need to fill the pipeline.
              </h2>
              <p className="mt-5 max-w-[540px] text-[17px] leading-[1.55] tracking-[-0.01em] text-[var(--color-text-2)]">
                One agent that profiles your company, finds signals, verifies contacts, and runs outreach — all the way through to a reply.
              </p>
            </div>
          </ScrollReveal>

          <div className="mt-12 grid grid-cols-1 gap-3 md:grid-cols-2 lg:gap-4">
            {FEATURES.map((feature, i) => (
              <ScrollReveal key={feature.title} delay={i * 0.08}>
                <article className="group relative h-full overflow-hidden rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-7 transition-colors hover:border-[var(--color-line-3)]">
                  <div className={`mb-5 inline-flex size-10 items-center justify-center rounded-[10px] ${TONE_BG[feature.tone]}`}>
                    <Icon name={feature.icon} size={18} />
                  </div>
                  <h3 className="text-[20px] font-semibold tracking-[-0.015em] text-[var(--color-text-1)]">
                    {feature.title}
                  </h3>
                  <p className="mt-3 max-w-[42ch] text-[14.5px] leading-[1.55] tracking-[-0.01em] text-[var(--color-text-2)]">
                    {feature.description}
                  </p>
                </article>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* STACK GRID */}
      <section id="signals" className="relative scroll-mt-24 border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-20 md:px-8 md:py-28 lg:px-12">
          <ScrollReveal>
            <div className="mb-12 max-w-[640px]">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">
                Replaces six tools
              </p>
              <h2
                className="mt-4 text-[clamp(1.75rem,3.6vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.02em] text-[var(--color-text-1)]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                One agent. One bill. One source of truth.
              </h2>
            </div>
          </ScrollReveal>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {STACK.map((card, i) => (
              <ScrollReveal key={card.title} delay={i * 0.05}>
                <div className="h-full rounded-[14px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5 transition-colors hover:border-[var(--color-line-3)]">
                  <div className="grid size-9 place-items-center rounded-[10px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
                    <Icon name={card.icon} size={16} />
                  </div>
                  <p className="mt-4 text-[15px] font-semibold tracking-[-0.01em] text-[var(--color-text-1)]">
                    {card.title}
                  </p>
                  <p className="mt-1 text-[12.5px] leading-[1.5] text-[var(--color-text-3)]">
                    {card.desc}
                  </p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* STEPS */}
      <section id="how" className="relative scroll-mt-24 border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-20 md:px-8 md:py-28 lg:px-12 lg:py-32">
          <ScrollReveal>
            <div className="mx-auto mb-16 max-w-[680px] text-center">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">
                Three minutes
              </p>
              <h2
                className="mt-4 text-[clamp(1.75rem,3.6vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.02em] text-[var(--color-text-1)]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Set up. First qualified reply today.
              </h2>
            </div>
          </ScrollReveal>
          <div className="grid gap-12 md:grid-cols-3 md:gap-8">
            {STEPS.map((step, i) => (
              <ScrollReveal key={step.number} delay={i * 0.12}>
                <div className="relative">
                  <span
                    className="text-[80px] font-bold leading-[0.86] tracking-[-0.04em] text-[var(--color-text-1)]"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {step.number}
                  </span>
                  <h3 className="mt-4 text-[20px] font-semibold tracking-[-0.015em] text-[var(--color-text-1)]">
                    {step.title}
                  </h3>
                  <p className="mt-2 max-w-[36ch] text-[14.5px] leading-[1.55] tracking-[-0.01em] text-[var(--color-text-2)]">
                    {step.description}
                  </p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* INVERSE CTA PANEL — Ploy signature */}
      <section className="relative px-4 py-12 md:px-8 md:py-16 lg:px-12">
        <div className="mx-auto w-full max-w-[1280px]">
          <ScrollReveal>
            <div className="relative overflow-hidden rounded-[24px] bg-[var(--color-cta-bg)] px-8 py-16 text-[var(--color-cta-text)] md:px-16 md:py-24 lg:px-20 lg:py-28">
              <div className="relative z-10 mx-auto max-w-[720px] text-center">
                <span className="btn-brand-on-dark tone-green">
                  <Icon name="rocket_launch" size={13} />
                  Launch today
                </span>
                <h2
                  className="mt-6 text-[clamp(2rem,5vw,4rem)] font-bold leading-[0.98] tracking-[-0.04em]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Pipeline that builds itself.
                </h2>
                <p className="mt-6 mx-auto max-w-[440px] text-[16px] leading-[1.55] tracking-[-0.01em] text-[#fff9]">
                  Free to start. No credit card. First buyer profile builds in minutes.
                </p>
                <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                  <Link
                    href={googleAuthPath('/onboarding')}
                    className="inline-flex h-12 items-center justify-center gap-1.5 rounded-full bg-[var(--color-ink-0)] px-6 text-[14px] font-semibold tracking-[-0.01em] text-[var(--color-text-1)] transition-transform hover:bg-[#f7f7f7] active:scale-[0.98]"
                  >
                    Start free
                    <Icon name="arrow_forward" size={15} />
                  </Link>
                  <a
                    href={FOUNDER_CALL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-on-dark"
                  >
                    Talk to founder
                  </a>
                </div>
              </div>

              {/* Decorative brand pills behind panel */}
              <div aria-hidden className="pointer-events-none absolute -left-8 -top-8 size-44 rounded-full bg-[var(--color-brand-pink)] opacity-20 blur-3xl" />
              <div aria-hidden className="pointer-events-none absolute -right-12 bottom-0 size-56 rounded-full bg-[var(--color-brand-green)] opacity-20 blur-3xl" />
              <div aria-hidden className="pointer-events-none absolute right-1/3 top-1/2 size-32 rounded-full bg-[var(--color-brand-blue)] opacity-20 blur-3xl" />
            </div>
          </ScrollReveal>
        </div>
      </section>

      <MarketingFooter />
    </main>
  )
}

/**
 * Living hero backdrop — soft brand glows over a faint structural grid.
 * Pure CSS, GPU-friendly, respects prefers-reduced-motion (orbs freeze).
 */
function HeroBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[860px] overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(33,33,33,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(33,33,33,0.025) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(120% 70% at 50% 0%, #000 35%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(120% 70% at 50% 0%, #000 35%, transparent 78%)',
        }}
      />
      <div className="animated-bg-orb absolute -left-[12%] -top-[18%] size-[640px] rounded-full bg-[var(--color-brand-pink)] opacity-[0.18] blur-[90px]" />
      <div className="animated-bg-orb absolute right-[-10%] top-[2%] size-[560px] rounded-full bg-[var(--color-brand-blue)] opacity-[0.2] blur-[90px]" style={{ animationDelay: '-7s' }} />
      <div className="animated-bg-orb absolute left-[38%] top-[24%] size-[420px] rounded-full bg-[var(--color-brand-green)] opacity-[0.16] blur-[90px]" style={{ animationDelay: '-14s' }} />
    </div>
  )
}

function HeroPane() {
  return (
    <div className="relative w-full">
      {/* Decorative accent behind pane */}
      <div aria-hidden className="pointer-events-none absolute -inset-x-6 -top-10 -bottom-6 -z-10 rounded-[28px] bg-gradient-to-br from-[var(--color-brand-pink)]/30 via-[var(--color-brand-yellow)]/20 to-[var(--color-brand-blue)]/30" />

      <div className="relative overflow-hidden rounded-[20px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] depth-stack">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-[var(--color-line-1)] px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-[#ff6157]" />
          <span className="size-2.5 rounded-full bg-[#ffbd2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 inline-flex h-6 flex-1 items-center justify-center rounded-md bg-[var(--color-ink-2)] px-2 text-[11px] text-[var(--color-text-3)]">
            app.bombsell.com / agent
          </span>
        </div>

        {/* App body */}
        <div className="grid grid-cols-[64px_minmax(0,1fr)]">
          {/* Mini sidebar */}
          <div className="flex flex-col items-center gap-3 border-r border-[var(--color-line-1)] bg-[var(--color-ink-1)] py-4">
            {['dashboard', 'auto_awesome', 'person'].map((icon, i) => (
              <span
                key={icon}
                className={
                  'grid size-9 place-items-center rounded-full ' +
                  (i === 1
                    ? 'bg-[var(--color-cta-bg)] text-[var(--color-cta-text)]'
                    : 'text-[var(--color-text-3)] hover:bg-[var(--color-ink-2)]')
                }
              >
                <Icon name={icon} size={16} />
              </span>
            ))}
          </div>

          {/* Main pane */}
          <div className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">
                  Today
                </p>
                <p
                  className="mt-1.5 text-[22px] font-bold leading-[1.1] tracking-[-0.02em] text-[var(--color-text-1)]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  12 qualified signals
                </p>
              </div>
              <span className="btn-brand-on-dark tone-pink">
                <span className="size-1.5 rounded-full bg-[var(--color-brand-pink)] pulse-dot" />
                Live
              </span>
            </div>

            <div className="mt-4 grid gap-2">
              {PROOF_SIGNALS.map((sig) => (
                <div
                  key={sig.kind}
                  className="flex items-center justify-between rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2.5 transition-colors hover:border-[var(--color-line-3)]"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={`size-2 shrink-0 rounded-full ${TONE_DOT[sig.tone]}`} />
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-semibold tracking-[-0.01em] text-[var(--color-text-1)]">
                        {sig.kind}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--color-text-3)]">
                        {sig.who} · qualified
                      </span>
                    </span>
                  </div>
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--color-text-2)]">
                    <Icon name="schedule" size={11} />
                    {sig.when}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <MiniStat label="Sent" value="38" />
              <MiniStat label="Replies" value="6" />
              <MiniStat label="Meetings" value="3" />
            </div>

            <div className="mt-4 flex items-center justify-between rounded-[10px] bg-[var(--color-cta-bg)] px-3.5 py-2.5">
              <span className="text-[12px] font-semibold tracking-[-0.01em] text-[#fff9]">
                Reply rate this week
              </span>
              <span className="text-[14px] font-bold tracking-[-0.01em] text-[var(--color-brand-green-bright)]">
                15.7%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] bg-[var(--color-ink-1)] px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-text-3)]">
        {label}
      </p>
      <p className="mt-1 text-[18px] font-bold tabular-nums tracking-[-0.02em] text-[var(--color-text-1)]">
        {value}
      </p>
    </div>
  )
}
