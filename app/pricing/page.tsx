'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getPaygPackCredits } from '@/lib/lead-credits'
import { useToast } from '@/components/Toast'

/**
 * Pricing — editorial, mono labels, 4-column comparison row.
 * No blobs, no decorative chrome. Numbered sections.
 */

const PLANS = [
  {
    id: 'launch' as const,
    name: 'Launch',
    monthly: 49, annual: 490,
    tagline: 'Solo operators',
    features: [
      'Outbound + Content engines',
      'All agents — compose your own stack',
      'Autopilot (per-agent autonomy)',
      '3 connected inboxes',
      'Use default or bring your own LLM',
      '100 outcome credits / month included',
    ],
    cta: 'Start Launch',
  },
  {
    id: 'team' as const,
    name: 'Team',
    monthly: 149, annual: 1490,
    tagline: 'Teams',
    features: [
      'Everything in Launch',
      'Team workspaces &amp; member roles',
      'Team pipeline &amp; workspace roles',
      'CRM agent (HubSpot / Salesforce / …)',
      '10 connected inboxes',
      '350 outcome credits / month included',
    ],
    cta: 'Start Team',
    highlight: true,
  },
] as const

// Dollar amounts must match CREDIT_TOP_UP_AMOUNTS in lib/lead-credits.ts.
const PAYG = [
  { dollars: 25, label: 'Plus' },
  { dollars: 50, label: 'Pro' },
  { dollars: 100, label: 'Max' },
]

const FAQS: Array<[string, string]> = [
  ['Why only two plans?', 'The plan price buys features. Everything that varies — leads worked, posts published — is metered in outcome credits, so you pick a tier for the capabilities you need, not a usage bracket.'],
  ['What burns a credit?', 'Outcomes. A positive reply, a booked meeting, a published post (plus a bonus when it performs), and hard third-party costs like verified contacts. Drafting, idea generation, and research-only agent runs are free.'],
  ['What happens when I run out of credits?', 'Outcomes still happen — we never block them. The balance goes negative until your monthly grant renews, or you top up with a credit pack.'],
  ['Is the agent API metered separately?', 'No — agent-to-agent calls draw from the same credit balance, on the same outcome basis. Costs are advertised per tool — see /docs.'],
  ['Can I use my own LLM?', 'Yes. Connect a Claude or ChatGPT key and drafting / content writing run on your key with no LLM credit charge. Otherwise the Bombsell Default LLM is used.'],
  ['How is outbound kept safe?', 'Per-account warmup, daily caps, verified contacts, unsubscribe checks, bounce suppression, reply-stop — enforced by the safety agent before anything sends.'],
]

export default function PricingPage() {
  const router = useRouter()
  const toast = useToast()
  const [signedIn, setSignedIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [annual, setAnnual] = useState(false)

  useEffect(() => {
    void createClient().auth.getSession().then(({ data }) => setSignedIn(!!data.session))
  }, [])

  async function googleStart() {
    setBusy(true)
    const supabase = createClient()
    const callback = new URL('/auth/callback', window.location.origin)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callback.toString(), queryParams: { access_type: 'offline', prompt: 'consent' } },
    })
    if (error) setBusy(false)
  }

  async function startCheckout(tier: 'launch' | 'team') {
    if (!signedIn) return googleStart()
    setBusy(true)
    try {
      const res = await fetch('/api/billing/subscription/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, period: annual ? 'annual' : 'monthly' }),
      })
      const data = await res.json().catch(() => null) as { url?: string; error?: string } | null
      if (data?.url) window.location.assign(data.url)
      else { setBusy(false); toast.error(data?.error ?? 'Could not start checkout.') }
    } catch {
      setBusy(false); toast.error('Could not start checkout.')
    }
  }

  function action(plan: typeof PLANS[number]) {
    void startCheckout(plan.id)
  }

  async function buyCredits(amountDollars: number) {
    if (!signedIn) return googleStart()
    setBusy(true)
    try {
      const res = await fetch('/api/billing/credits/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_dollars: amountDollars }),
      })
      const data = await res.json().catch(() => null) as { url?: string; error?: string } | null
      if (data?.url) window.location.assign(data.url)
      else { setBusy(false); toast.error(data?.error ?? 'Could not start checkout.') }
    } catch { setBusy(false); toast.error('Could not start checkout.') }
  }

  return (
    <div className="relative min-h-screen flex flex-col bg-[var(--color-ink-1)]">
      <Nav signedIn={signedIn} busy={busy} onStart={() => signedIn ? router.push('/dashboard') : void googleStart()} />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden hero-bg">
        <div className="max-w-[1280px] mx-auto px-margin-page pt-20 md:pt-24 pb-16 text-center">
          <div className="flex items-center justify-center gap-3 mb-8">
            <span className="section-num">01</span>
            <span className="h-px w-10 bg-[var(--color-line-2)]" />
            <span className="mono">Pricing</span>
          </div>
          <h1 className="editorial-h2 max-w-3xl mx-auto">
            Pay for <span className="serif-italic text-[var(--color-accent)]">outcomes</span>, not seats.
          </h1>
          <p className="text-[16px] text-[var(--color-text-3)] mt-6 max-w-xl mx-auto leading-relaxed">
            Two plans — the price buys features. Everything that varies (leads worked, posts published) is metered in outcome credits.
          </p>

          {/* Billing toggle */}
          <div className="mt-10 inline-flex items-center gap-1 border border-[var(--color-line-2)] rounded-full p-1">
            <button onClick={() => setAnnual(false)} className={`h-8 px-4 rounded-full text-[12.5px] transition-colors ${!annual ? 'bg-[var(--color-text-1)] text-[var(--color-ink-0)]' : 'text-[var(--color-text-2)]'}`}>Monthly</button>
            <button onClick={() => setAnnual(true)} className={`h-8 px-4 rounded-full text-[12.5px] transition-colors ${annual ? 'bg-[var(--color-text-1)] text-[var(--color-ink-0)]' : 'text-[var(--color-text-2)]'}`}>Annual <span className="text-[var(--color-accent)]">−17%</span></button>
          </div>
        </div>
        </section>

        {/* Plans */}
        <section className="max-w-3xl mx-auto px-margin-page pb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[var(--color-line-1)] border border-[var(--color-line-1)] rounded-2xl overflow-hidden">
            {PLANS.map((p) => (
              <div key={p.id} className={`bg-[var(--color-ink-1)] p-7 flex flex-col relative ${'highlight' in p && p.highlight ? 'bg-[var(--color-ink-2)]' : ''}`}>
                {'highlight' in p && p.highlight && (
                  <span className="absolute top-4 right-4 mono text-[var(--color-accent)]">For teams</span>
                )}
                <div className="mono mb-3">{p.name}</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[40px] font-medium tracking-tight">${annual ? Math.round((p.annual ?? 0) / 12) : p.monthly}</span>
                  <span className="mono">/mo</span>
                </div>
                {annual && <div className="mono mt-1">${p.annual} billed annually</div>}
                <p className="text-[13.5px] text-[var(--color-text-3)] mt-3" dangerouslySetInnerHTML={{ __html: p.tagline }} />

                <ul className="mt-6 space-y-2.5 text-[13px] text-[var(--color-text-2)] flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <span className="text-[var(--color-accent)] pt-[3px]">◆</span>
                      <span dangerouslySetInnerHTML={{ __html: f }} />
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => action(p)}
                  disabled={busy}
                  className={`mt-7 h-10 text-[13px] disabled:opacity-50 ${'highlight' in p && p.highlight ? 'btn-accent' : 'btn-ghost'}`}
                >
                  {p.cta} →
                </button>
              </div>
            ))}
          </div>
          <p className="text-center text-[12.5px] text-[var(--color-text-3)] mt-4">
            Need custom volume, security review, or a dedicated workspace? <a href="mailto:team@bombsell.com?subject=Bombsell%20Enterprise" className="text-[var(--color-accent)] hover:underline">Talk to us</a>.
          </p>
        </section>

        {/* PAYG */}
        <section className="border-t border-[var(--color-line-1)]">
          <div className="max-w-[1280px] mx-auto px-margin-page py-20 grid md:grid-cols-12 gap-10">
            <div className="md:col-span-4">
              <div className="flex items-center gap-3 mb-6">
                <span className="section-num">02</span>
                <span className="h-px w-10 bg-[var(--color-line-2)]" />
                <span className="mono">Pay as you go</span>
              </div>
              <h2 className="editorial-h2">Run low? <span className="serif-italic text-[var(--color-accent)]">Top up.</span></h2>
              <p className="text-[14px] text-[var(--color-text-3)] mt-4 max-w-sm">Add outcome credits any time on top of your monthly grant. No expiry.</p>
            </div>
            <div className="md:col-span-8 grid sm:grid-cols-3 gap-3">
              {PAYG.map((p) => {
                const credits = getPaygPackCredits(p.dollars)
                return (
                  <button key={p.dollars} onClick={() => void buyCredits(p.dollars)} disabled={busy} className="card p-5 text-left hover:border-[var(--color-text-1)] transition-colors disabled:opacity-50">
                    <div className="mono">{p.label}</div>
                    <div className="text-[28px] font-medium tracking-tight mt-2">${p.dollars}</div>
                    <div className="mono mt-1">{credits > 0 ? `${credits} credits` : 'credits at checkout'}</div>
                    {credits > 0 && <div className="text-[12px] text-[var(--color-text-3)] mt-3">${(p.dollars / credits).toFixed(2)} / credit</div>}
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-t border-[var(--color-line-1)]">
          <div className="max-w-[1280px] mx-auto px-margin-page py-20">
            <div className="flex items-center gap-3 mb-10">
              <span className="section-num">03</span>
              <span className="h-px w-10 bg-[var(--color-line-2)]" />
              <span className="mono">FAQ</span>
            </div>
            <div className="grid md:grid-cols-2 gap-x-14 gap-y-2 max-w-5xl">
              {FAQS.map(([q, a]) => (
                <details key={q} className="border-b border-[var(--color-line-1)] py-5 group">
                  <summary className="flex items-center justify-between cursor-pointer list-none">
                    <span className="text-[15px] font-medium tracking-tight">{q}</span>
                    <span className="text-[var(--color-text-3)] group-open:rotate-45 transition-transform">+</span>
                  </summary>
                  <p className="text-[13.5px] text-[var(--color-text-3)] mt-3 leading-relaxed">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}

/* ─── Shared chrome ───────────────────────────────────────────── */

function Nav({ signedIn, busy, onStart }: { signedIn: boolean; busy: boolean; onStart: () => void }) {
  const links: Array<[string, string, boolean]> = [
    ['How it works', '/#loop', false],
    ['For agents', '/#agents', false],
    ['For teams', '/#teams', false],
    ['Pricing', '/pricing', true],
    ['Docs', '/docs', false],
  ]
  return (
    <header className="sticky top-0 w-full z-50 bg-surface/70 backdrop-blur-xl border-b border-outline-variant/15">
      <nav className="flex justify-between items-center h-16 px-margin-page max-w-[1280px] mx-auto">
        <Link href="/" className="font-semibold text-[19px] tracking-tight text-on-surface">Bombsell</Link>
        <div className="hidden md:flex items-center gap-stack-lg">
          {links.map(([label, href, active]) => (
            <Link
              key={label}
              href={href}
              className={`font-body-main text-body-main transition-colors cursor-pointer ${active ? 'text-primary font-medium' : 'text-on-surface-variant hover:text-primary'}`}
            >
              {label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-stack-md">
          <button
            onClick={onStart}
            disabled={busy}
            className="bg-primary text-on-primary px-stack-md py-stack-sm font-label-mono text-label-mono uppercase tracking-widest hover:bg-primary-container transition-colors disabled:opacity-60"
          >
            {busy ? 'Loading…' : signedIn ? 'Dashboard →' : 'Start Free'}
          </button>
        </div>
      </nav>
    </header>
  )
}


function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-line-1)] py-10 mt-10">
      <div className="max-w-[1280px] mx-auto px-margin-page flex flex-wrap gap-x-6 gap-y-2 items-center justify-between text-[12px] text-[var(--color-text-4)]">
        <span>© {new Date().getFullYear()} Bombsell</span>
        <div className="flex items-center gap-5">
          <Link href="/privacy" className="hover:text-[var(--color-text-2)]">Privacy</Link>
          <Link href="/terms" className="hover:text-[var(--color-text-2)]">Terms</Link>
          <Link href="/api/docs/agents" className="hover:text-[var(--color-text-2)]">API</Link>
        </div>
      </div>
    </footer>
  )
}
