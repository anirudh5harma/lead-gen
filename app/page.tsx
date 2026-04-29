'use client'

import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'
import Image from 'next/image'
import MarketingNavbar from '@/components/MarketingNavbar'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signInWithGoogle() {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const params = new URLSearchParams(window.location.search)
    const next = params.get('next')
    const callback = new URL('/auth/callback', window.location.origin)
    if (next?.startsWith('/') && !next.startsWith('//')) {
      callback.searchParams.set('next', next)
    }
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callback.toString(),
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (authError) { setError(authError.message); setLoading(false) }
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden paper">
      {/* Ambient cream blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
        <div className="blob blob-1" style={{ width: 600, height: 600, top: -180, left: -120 }} />
        <div className="blob blob-2" style={{ width: 500, height: 500, top: 100, right: -160 }} />
      </div>

      <MarketingNavbar homeAnchors />

      <main className="relative z-10 flex-1">
        {/* Hero */}
        <section className="w-full max-w-7xl mx-auto px-6 md:px-8 pt-20 md:pt-28 pb-16 md:pb-20 grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center">
          <div className="space-y-8 fade-in">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--color-line-2)] bg-white text-[11px] text-[var(--color-text-2)] shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] pulse-dot" />
              AI-native GTM infra · self-serve today, enterprise OS next
            </div>

            <h1 className="text-[44px] md:text-[68px] leading-[0.98] tracking-[-0.02em] text-[var(--color-text-1)] font-medium">
              The revenue
              <span className="font-serif italic text-gradient"> OS</span>{' '}
              <br />
              <span>for AI-native teams.</span>
            </h1>

            <p className="text-[17px] leading-[1.55] text-[var(--color-text-2)] max-w-[540px]">
              Bombsell turns buying signals, CRM context, inbox workflows, and agent actions into one operating layer for revenue. Start self-serve; scale toward an AI-native service company that runs GTM execution for enterprises.
            </p>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={signInWithGoogle}
                disabled={loading}
                className="h-12 px-6 rounded-full btn-primary text-[14px] font-medium disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <GoogleIconSmall />
                )}
                {loading ? 'Redirecting…' : 'Start free with Google'}
              </button>
              <a
                href="#how"
                className="h-12 px-6 rounded-full btn-ghost text-[14px] flex items-center"
              >
                See the operating layer
              </a>
            </div>

            {error && (
              <p className="text-xs text-[var(--color-sig-regulation)] bg-[var(--color-sig-regulation-bg)] border border-[var(--color-sig-regulation)]/20 rounded-lg px-3 py-2 max-w-sm">
                {error}
              </p>
            )}

            <div className="flex items-center gap-5 text-[12px] text-[var(--color-text-3)]">
              <span className="inline-flex items-center gap-1.5">
                <CheckMark /> Free self-serve workspace
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckMark /> Agent-ready with MCP
              </span>
              <span className="hidden sm:inline-flex items-center gap-1.5">
                <CheckMark /> CRM, inbox, Slack workflows
              </span>
            </div>
          </div>

          <ProductPreview />
        </section>

        {/* Trust strip */}
        <section className="border-y border-[var(--color-line-1)] bg-[var(--color-ink-2)]/40">
          <div className="w-full max-w-7xl mx-auto px-6 md:px-8 py-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-3)] mr-4">
              Built for the teams replacing GTM bloat
            </p>
            {['Revenue intelligence', 'Signal mining', 'CRM automation', 'Inbox execution', 'Agent workflows', 'RevOps services'].map(f => (
              <span key={f} className="text-[13px] text-[var(--color-text-2)] font-medium">{f}</span>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="w-full max-w-7xl mx-auto px-6 md:px-8 py-24 md:py-32">
          <div className="max-w-2xl mb-16">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)] font-medium mb-4">How it works</p>
            <h2 className="text-4xl md:text-5xl tracking-[-0.02em] text-[var(--color-text-1)] font-medium leading-[1.05]">
              From scattered GTM data to <span className="font-serif italic">revenue action.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 fade-in-stagger">
            {STEPS.map((step, i) => (
              <div
                key={step.title}
                className="card p-7 flex flex-col gap-4 hover:shadow-md transition-shadow relative overflow-hidden"
              >
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)] flex items-center justify-center">
                    {step.icon}
                  </div>
                  <span className="text-[11px] font-mono text-[var(--color-text-4)]">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
                <h3 className="text-[17px] font-medium text-[var(--color-text-1)] tracking-tight">{step.title}</h3>
                <p className="text-[13.5px] leading-[1.55] text-[var(--color-text-2)]">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Feature strip */}
        <section id="features" className="bg-[var(--color-ink-2)]/50 border-y border-[var(--color-line-1)]">
          <div className="w-full max-w-7xl mx-auto px-6 md:px-8 py-24 md:py-32 grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-12 lg:gap-20 items-center">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)] font-medium mb-4">Revenue OS</p>
              <h2 className="text-4xl md:text-5xl tracking-[-0.02em] text-[var(--color-text-1)] font-medium leading-[1.05] mb-8">
                One layer for signals,<br />
                workflows, and <span className="font-serif italic">agents.</span>
              </h2>
              <ul className="space-y-4">
                {FEATURES.map(f => (
                  <li key={f.title} className="flex items-start gap-3 max-w-md">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)] flex items-center justify-center shrink-0">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <div>
                      <p className="text-[14px] font-medium text-[var(--color-text-1)]">{f.title}</p>
                      <p className="text-[13px] text-[var(--color-text-2)] leading-[1.5] mt-0.5">{f.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <EmailPreview />
          </div>
        </section>

        {/* Enterprise vision */}
        <section className="w-full max-w-7xl mx-auto px-6 md:px-8 py-24 md:py-32">
          <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-16 items-start">
            <div className="sticky top-24">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)] font-medium mb-4">Where this is going</p>
              <h2 className="text-4xl md:text-5xl tracking-[-0.02em] text-[var(--color-text-1)] font-medium leading-[1.05]">
                An AI-native service company for <span className="font-serif italic">enterprise GTM.</span>
              </h2>
              <p className="text-[15px] leading-[1.65] text-[var(--color-text-2)] mt-5 max-w-md">
                The free plan is the productized entry point. The larger ambition is managed revenue infrastructure: agents, operators, data, and workflows that enterprises can plug into instead of stitching together another stack.
              </p>
            </div>

            <div className="grid gap-4">
              {VISION_LAYERS.map(layer => (
                <div key={layer.title} className="card p-6 grid gap-3">
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="text-[16px] font-medium text-[var(--color-text-1)] tracking-tight">{layer.title}</h3>
                    <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-4)]">{layer.stage}</span>
                  </div>
                  <p className="text-[13.5px] leading-[1.6] text-[var(--color-text-2)]">{layer.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing teaser */}
        <section className="w-full max-w-7xl mx-auto px-6 md:px-8 py-24 md:py-32">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)] font-medium mb-4">Pricing</p>
            <h2 className="text-4xl md:text-5xl tracking-[-0.02em] text-[var(--color-text-1)] font-medium leading-[1.05]">
              Self-serve first. Enterprise when GTM needs an <span className="font-serif italic">operating system.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
            {TIERS.map(tier => (
              <div
                key={tier.name}
                className={`card p-7 flex flex-col gap-5 relative ${tier.highlight ? 'ring-1 ring-[var(--color-accent)]/40 shadow-[0_20px_60px_-20px_var(--color-accent-glow)]' : ''}`}
              >
                {tier.highlight && (
                  <span className="absolute -top-2.5 left-7 text-[10px] font-semibold uppercase tracking-[0.14em] px-2.5 py-1 rounded-full bg-[var(--color-accent)] text-white">
                    Popular
                  </span>
                )}
                <div>
                  <p className="text-[13px] text-[var(--color-text-3)] font-medium">{tier.name}</p>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-3xl font-semibold tracking-tight text-[var(--color-text-1)]">{tier.price}</span>
                    <span className="text-[12px] text-[var(--color-text-4)]">{tier.period}</span>
                  </div>
                </div>
                <div className="hairline" />
                <ul className="space-y-2 text-[13px] text-[var(--color-text-2)] flex-1">
                  {tier.perks.map(p => (
                    <li key={p} className="flex items-start gap-2">
                      <span className="text-[var(--color-accent-ring)] mt-0.5">✓</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href={tier.href}
                  onClick={tier.name === 'Self-serve' ? signInWithGoogle : undefined}
                  className={`h-10 rounded-full text-[13px] font-medium flex items-center justify-center ${tier.highlight ? 'btn-primary' : 'btn-ghost'}`}
                >
                  {tier.cta}
                </a>
              </div>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="w-full max-w-7xl mx-auto px-6 md:px-8 pb-24">
          <div className="relative card overflow-hidden p-10 md:p-16 text-center">
            <div aria-hidden className="absolute inset-0 pointer-events-none">
              <div className="blob blob-1" style={{ width: 420, height: 420, top: -140, left: '50%', transform: 'translateX(-50%)', opacity: 0.7 }} />
            </div>
            <div className="relative space-y-6 max-w-xl mx-auto">
              <h3 className="text-3xl md:text-5xl font-medium tracking-[-0.02em] text-[var(--color-text-1)] leading-[1.05]">
                Build the GTM layer your <span className="font-serif italic text-gradient">AI agents can operate.</span>
              </h3>
              <p className="text-[15px] text-[var(--color-text-2)]">
                Start by finding high-intent leads. Scale into a revenue OS that watches the market, syncs the CRM, triggers workflows, and lets humans and agents act from the same context.
              </p>
              <button
                onClick={signInWithGoogle}
                disabled={loading}
                className="h-12 px-7 rounded-full btn-primary text-[14px] font-medium inline-flex items-center gap-2 disabled:opacity-60 cursor-pointer"
              >
                <GoogleIconSmall /> Continue with Google
              </button>
              <p className="text-[12px] text-[var(--color-text-4)]">
                Free self-serve workspace · No card required · Enterprise workflows by design
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-[var(--color-line-1)]">
        <div className="w-full max-w-7xl mx-auto px-6 md:px-8 py-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <LogoMark small />
            <span className="text-xs text-[var(--color-text-3)]">© {new Date().getFullYear()} Bombsell</span>
          </div>
          <div className="flex items-center gap-6 text-[12px] text-[var(--color-text-3)]">
            <a href="/pricing" className="hover:text-[var(--color-text-1)] transition-colors">Pricing</a>
            <Link href="/privacy" className="hover:text-[var(--color-text-1)] transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-[var(--color-text-1)] transition-colors">Terms</Link>
            <a href="mailto:team@bombsell.com" className="hover:text-[var(--color-text-1)] transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ── Data ─────────────────────────────────────────────────────────────

const STEPS = [
  {
    title: 'Ingest the market',
    body: 'Bombsell listens for buying moments across funding, hiring, product, expansion, regulation, CRM imports, and watched accounts.',
    icon: <IconRadar />,
  },
  {
    title: 'Map signals to revenue context',
    body: 'Each signal is scored against your ICP, workspace context, CRM records, and account history so the feed becomes a decision layer.',
    icon: <IconSpark />,
  },
  {
    title: 'Trigger human and agent workflows',
    body: 'Draft outreach, sync CRM, alert Slack, schedule follow-ups, and expose the same GTM context to Codex and Claude through MCP.',
    icon: <IconSend />,
  },
]

const FEATURES = [
  {
    title: 'Signal intelligence layer',
    body: 'Live company signals, prompt discovery, CRM imports, and watchlists feed one ranked revenue timeline.',
  },
  {
    title: 'Workflow execution layer',
    body: 'Generate outreach, send through Gmail or Outlook, pause on replies, and sync status changes back to your CRM workflows.',
  },
  {
    title: 'Agent consumption layer',
    body: 'MCP lets Codex, Claude, and future GTM agents inspect leads, update safe workflow state, and operate from Bombsell context.',
  },
  {
    title: 'Service-ready infrastructure',
    body: 'Multi-workspace, Slack alerts, credit top-ups, CRM sync, and audit-friendly workflows create the base for managed enterprise GTM.',
  },
]

const VISION_LAYERS = [
  {
    title: 'Self-serve GTM workspace',
    stage: 'Now',
    body: 'Founders, small teams, and agents use Bombsell to discover companies, unlock leads, draft outreach, export CRM records, and work from live feed sessions.',
  },
  {
    title: 'Revenue intelligence graph',
    stage: 'Next',
    body: 'Unify signals, accounts, contacts, CRM events, outreach outcomes, enrichment history, and intent feedback into a durable graph that learns what converts.',
  },
  {
    title: 'Enterprise workflow orchestration',
    stage: 'Build',
    body: 'Move from dashboards to governed workflows: account routing, approvals, enrichment budgets, compliance controls, CRM writebacks, and SLA-backed automation.',
  },
  {
    title: 'AI-native service company',
    stage: 'Scale',
    body: 'Package Bombsell with human operators and agent playbooks so enterprises buy outcomes: pipeline creation, market monitoring, expansion plays, and RevOps execution.',
  },
]

const TIERS = [
  {
    name: 'Self-serve',
    price: '$0',
    period: 'forever',
    perks: ['15 lead unlocks / month', 'AI prompt discovery', 'CRM sync and exports', 'Agent-ready MCP access'],
    cta: 'Get started',
    href: '#',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$129',
    period: '/ month',
    perks: ['500 leads / month', 'Gmail/Outlook execution', 'Reply-aware follow-ups', 'Multi-client workspaces', 'Slack alerts', 'Priority revenue workflows'],
    cta: 'Upgrade to Pro',
    href: '/pricing',
    highlight: true,
  },
  {
    name: 'Enterprise OS',
    price: 'Custom',
    period: 'managed GTM infra',
    perks: ['Managed revenue workflows', 'Enterprise CRM governance', 'Custom agent playbooks', 'Dedicated signal sources', 'Operator-in-the-loop execution', 'Security and audit controls'],
    cta: 'Talk to us',
    href: 'mailto:team@bombsell.com?subject=Enterprise%20Revenue%20OS',
    highlight: false,
  },
]

// ── Components ───────────────────────────────────────────────────────

function ProductPreview() {
  return (
    <div className="relative fade-in">
      <div aria-hidden className="absolute -inset-10 -z-10 blob blob-2" style={{ opacity: 0.5 }} />

      {/* Floating stat card */}
      <div className="absolute -top-4 -left-4 z-20 card px-3 py-2 flex items-center gap-2 fade-in">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-sig-funding)]" />
        <span className="text-[11px] font-medium text-[var(--color-text-1)]">+12 signal-matched accounts</span>
      </div>

      {/* Floating reply card */}
      <div className="absolute -bottom-4 -right-3 z-20 card px-3 py-2 flex items-center gap-2 fade-in">
        <span className="w-5 h-5 rounded-full bg-[var(--color-sig-funding-bg)] text-[var(--color-sig-funding)] flex items-center justify-center">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
        <span className="text-[11px] font-medium text-[var(--color-text-1)]">3 workflows triggered</span>
      </div>

      <div className="card overflow-hidden shadow-[0_24px_80px_-24px_#c15f3c33]">
        {/* window chrome */}
        <div className="flex items-center gap-2 px-4 h-10 border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/60">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]/70" />
          <span className="ml-3 text-[11px] text-[var(--color-text-3)] font-mono">bombsell.app / revenue-os</span>
        </div>

        {/* toolbar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-line-1)]">
          <div className="flex items-center gap-2">
            <span className="pill chip-funding">● Signals</span>
            <span className="pill chip-hiring">● CRM</span>
            <span className="pill chip-expansion">● Agents</span>
          </div>
          <span className="text-[11px] text-[var(--color-text-3)] font-mono">4 / 12</span>
        </div>

        {/* feed rows */}
        <div className="divide-y divide-[var(--color-line-1)]">
          {[
            { tone: 'funding',     company: 'Acme Robotics', headline: 'Closes $40M Series B',    detail: 'Benchmark · 2h',  score: 92 },
            { tone: 'hiring',      company: 'TechFlow',      headline: 'Hires VP Engineering',    detail: 'ex-Stripe · 5h',   score: 84 },
            { tone: 'expansion',   company: 'BuildBase',     headline: 'Opens EU HQ in Berlin',   detail: '40 roles · 1d',    score: 78 },
            { tone: 'acquisition', company: 'Northwind Labs',headline: 'Acquires Drift analytics',detail: 'undisclosed · 2d', score: 71 },
          ].map((row, i) => (
            <div
              key={row.company}
              className={`px-4 py-3 flex items-center gap-3 ${i === 0 ? 'bg-[var(--color-accent-soft)]' : ''}`}
            >
              <span className={`pill chip-${row.tone} text-[10px] px-1.5`}>●</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-[13px] font-medium text-[var(--color-text-1)] truncate">{row.company}</p>
                  <span className="text-[12px] text-[var(--color-text-3)] truncate">· {row.headline}</span>
                </div>
                <p className="text-[11px] text-[var(--color-text-4)] mt-0.5">{row.detail}</p>
              </div>
              <div className="shrink-0 flex items-center gap-1.5">
                <div className="w-10 h-1 rounded-full bg-[var(--color-ink-3)] overflow-hidden">
                  <div className="h-full bg-[var(--color-accent)]" style={{ width: `${row.score}%` }} />
                </div>
                <span className="text-[11px] font-mono text-[var(--color-text-1)] tabular-nums w-6 text-right">{row.score}</span>
              </div>
            </div>
          ))}
        </div>

        {/* sticky action bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--color-line-1)] bg-[var(--color-ink-2)]/40">
          <p className="text-[11px] text-[var(--color-text-3)]">
            <span className="kbd">MCP</span>
            <span className="ml-2">Codex and Claude ready</span>
          </p>
          <span aria-hidden className="h-7 px-3 rounded-full btn-primary text-[11px] font-medium inline-flex items-center gap-1.5 pointer-events-none cursor-default select-none">
            Trigger workflow →
          </span>
        </div>
      </div>
    </div>
  )
}

function EmailPreview() {
  return (
    <div className="card overflow-hidden relative">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/60">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)] flex items-center justify-center text-[11px] font-semibold">A</div>
          <span className="text-[12px] font-medium text-[var(--color-text-1)]">Ari @ Acme</span>
          <span className="text-[11px] text-[var(--color-text-4)]">ari@acme.com</span>
        </div>
        <span className="pill chip-funding">Ready to send</span>
      </div>

      <div className="px-5 py-4 space-y-3 text-[13.5px] leading-[1.6] text-[var(--color-text-1)]">
        <p className="text-[12px] text-[var(--color-text-4)]">
          Subject: <span className="text-[var(--color-text-2)]">Congrats on the $40M — a thought on your post-raise hiring loop</span>
        </p>
        <p>Hey Ari —</p>
        <p>
          Saw the Benchmark-led Series B yesterday. Impressive round,
          especially the industrial-automation angle.
        </p>
        <p>
          A handful of hardware scale-ups we work with used{' '}
          <span className="underline decoration-[var(--color-accent)] decoration-2 underline-offset-2">[our tool]</span>{' '}
          to cut their post-raise hiring loop by 40% — mostly by automating
          the scheduling and feedback intake. Feels relevant given you&rsquo;re
          probably about to 3x the team.
        </p>
        <p>Worth a 15-min swap next week?</p>
        <p className="text-[var(--color-text-3)]">— Jamie</p>
      </div>

      <div className="flex items-center gap-2 px-5 py-3 border-t border-[var(--color-line-1)] bg-[var(--color-ink-2)]/40">
        <span aria-hidden className="h-8 px-3 rounded-full btn-primary text-[12px] font-medium inline-flex items-center pointer-events-none cursor-default select-none">Send</span>
        <span aria-hidden className="h-8 px-3 rounded-full btn-ghost text-[12px] inline-flex items-center pointer-events-none cursor-default select-none">Edit</span>
        <span aria-hidden className="h-8 px-3 rounded-full btn-ghost text-[12px] inline-flex items-center pointer-events-none cursor-default select-none">Regenerate</span>
        <span className="ml-auto text-[11px] text-[var(--color-text-3)]">Auto follow-up in 3 days</span>
      </div>
    </div>
  )
}

function LogoMark({ small = false }: { small?: boolean }) {
  const size = small ? 26 : 32
  return (
    <Image
      src="/logo.svg"
      alt="Bombsell"
      width={size}
      height={size}
      className="shrink-0"
    />
  )
}

function GoogleIconSmall() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" className="shrink-0">
      <path fill="#ffffff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" opacity="0.92"/>
      <path fill="#ffffff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" opacity="0.9"/>
      <path fill="#ffffff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" opacity="0.85"/>
      <path fill="#ffffff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}

function CheckMark() {
  return (
    <svg className="w-3.5 h-3.5 text-[var(--color-accent-ring)]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

function IconRadar() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="7" strokeOpacity="0.5" />
      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
    </svg>
  )
}
function IconSpark() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
function IconSend() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 12l16-8-6 18-2.5-7.5L4 12z" />
    </svg>
  )
}
