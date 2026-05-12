'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Icon from '@/components/Icon'

/**
 * Bombsell landing — editorial, command-led. Mirrors the Stitch
 * "Bombsell — Landing Page Updated" composition:
 *   nav · hero + command bar · The Loop (8 cells) · For Agents (SDK)
 *   · For Teams (live signal feed) · Integration Partners · CTA · footer
 */
export default function LandingPage() {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [website, setWebsite] = useState('')

  async function startWith(prefill?: string) {
    setLoading(true); setErr(null)
    const url = normalize(prefill ?? website)
    if (url) window.localStorage.setItem('bombsell:onboarding:website_url', url)
    const supabase = createClient()
    const callback = new URL('/auth/callback', window.location.origin)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callback.toString(),
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (error) { setErr(error.message); setLoading(false) }
  }

  return (
    <div className="page-grid min-h-screen flex flex-col bg-surface font-body-main text-on-surface">
      <TopNav loading={loading} onStart={() => void startWith()} />

      <main className="flex-1">
        <Hero
          website={website}
          setWebsite={setWebsite}
          loading={loading}
          err={err}
          onSubmit={() => void startWith(website)}
        />
        <TheLoop />
        <ForAgents />
        <ForTeams />
        <Integrations />
        <FinalCta loading={loading} onStart={() => void startWith()} />
      </main>

      <Footer />
    </div>
  )
}

/* ─── Nav ─────────────────────────────────────────────────────── */

function TopNav({ loading, onStart }: { loading: boolean; onStart: () => void }) {
  const links: Array<[string, string, boolean]> = [
    ['How it works', '#loop', true],
    ['For agents', '#agents', false],
    ['For teams', '#teams', false],
    ['Pricing', '/pricing', false],
    ['Docs', '/docs', false],
  ]
  return (
    <header className="fixed top-0 w-full z-50 bg-surface/70 backdrop-blur-xl border-b border-outline-variant/15">
      <nav className="flex justify-between items-center h-16 px-margin-page max-w-[1280px] mx-auto">
        <Link href="/" className="font-semibold text-[19px] tracking-tight text-on-surface">Bombsell</Link>
        <div className="hidden md:flex items-center gap-stack-lg">
          {links.map(([label, href, active]) => (
            <a
              key={label}
              href={href}
              className={`font-body-main text-body-main transition-colors cursor-pointer ${
                active ? 'text-primary font-medium' : 'text-on-surface-variant hover:text-primary'
              }`}
            >
              {label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-stack-md">
          <button
            onClick={onStart}
            disabled={loading}
            className="bg-primary text-on-primary px-stack-md py-stack-sm font-label-mono text-label-mono uppercase tracking-widest hover:bg-primary-container transition-colors disabled:opacity-60"
          >
            {loading ? 'Signing in…' : 'Start Free'}
          </button>
        </div>
      </nav>
    </header>
  )
}

/* ─── 01 Hero ─────────────────────────────────────────────────── */

function Hero({
  website, setWebsite, loading, err, onSubmit,
}: {
  website: string; setWebsite: (s: string) => void;
  loading: boolean; err: string | null; onSubmit: () => void;
}) {
  return (
    <section className="relative overflow-hidden hero-bg pt-32">
      <div className="max-w-[1280px] mx-auto px-margin-page pt-stack-lg pb-section-gap">
      <div className="max-w-[1120px] mx-auto text-center">
        <p className="reveal font-label-mono text-label-mono uppercase tracking-[0.2em] text-on-surface-variant mb-stack-md">Agentic GTM</p>

        <h1 className="reveal reveal-1 font-h1-editorial font-semibold text-on-surface leading-[1.08] tracking-[-0.02em] text-balance">
          <span className="block whitespace-nowrap text-[clamp(1rem,4.6vw,3.6rem)]">Building the Future GTM Stack</span>
          <span className="block text-[clamp(0.6rem,3vw,1.6rem)] pt-4 text-primary italic">Pay for outcomes, not seats.</span>
        </h1>

        <br></br>
        <p className="reveal reveal-2 font-body-large text-body-large text-on-surface-variant max-w-2xl mx-auto mt-stack-lg leading-relaxed">
          A fleet of agents running 24/7. You <b>pay when it works</b>.
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); onSubmit() }}
          className="reveal reveal-3 relative max-w-xl mx-auto mt-stack-lg group"
        >
          <div className="bg-surface-container-lowest hairline-border p-stack-sm flex items-center gap-stack-md shadow-sm text-left">
            <Icon name="search" className="text-on-surface-variant ml-2" />
            <input
              className="flex-grow bg-transparent border-none focus:ring-0 font-body-large text-body-large placeholder:text-outline outline-none"
              placeholder="Enter your company URL"
              type="text"
              inputMode="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              aria-label="Your company URL"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-primary text-on-primary px-stack-md py-stack-sm font-label-mono text-label-mono uppercase tracking-widest hover:bg-primary-container transition-colors disabled:opacity-60"
            >
              {loading ? 'Loading...' : 'Get Started'}
            </button>
          </div>
        </form>

        {err && <p className="mt-3 font-label-mono text-label-mono text-error">{err}</p>}
      </div>

      <div className="mt-section-gap flex justify-center">
        <HeroDiagram />
      </div>

      <div className="reveal reveal-4 mt-section-gap marquee-mask border-y border-outline-variant/30 py-stack-md">
        <div className="marquee-track gap-stack-lg">
          {[0, 1].map((k) => (
            <span key={k} className="flex gap-stack-lg pr-stack-lg">
              {['Buying signals', 'ICP matching', 'Verified contacts', 'Personalized outreach', 'Reply triage', 'Meeting booking', 'Idea generation', 'Brand-voice writing', 'LinkedIn & X publishing', 'Engagement tracking', 'Reward loop'].map((t) => (
                <span key={t} className="flex items-center gap-stack-lg font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant whitespace-nowrap">
                  {t}<span className="text-outline-variant">/</span>
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      
      </div>
    </section>
  )
}

/* --- Hero illustration: the GTM flywheel, as a stack with a feedback loop --- */

function DiagBar({ x, y, w, label, accent, cls }: { x: number; y: number; w: number; label: string; accent?: 'primary' | 'tertiary'; cls: string }) {
  const stroke = accent === 'primary' ? 'stroke-primary' : accent === 'tertiary' ? 'stroke-tertiary' : 'stroke-outline-variant'
  const text = accent === 'primary' ? 'fill-primary' : accent === 'tertiary' ? 'fill-tertiary' : 'fill-on-surface-variant'
  return (
    <g className={cls}>
      <rect x={x} y={y} width={w} height={34} rx={8} className={`fill-surface-container-lowest ${stroke}`} strokeWidth="1.5" />
      <text x={x + w / 2} y={y + 21} textAnchor="middle" className={text} style={{ fontFamily: 'var(--font-label-mono)', fontSize: 10.5, letterSpacing: 1.4 }}>{label}</text>
    </g>
  )
}
function DiagDown({ x, y1, y2, cls }: { x: number; y1: number; y2: number; cls: string }) {
  return <line x1={x} y1={y1} x2={x} y2={y2} className={`stroke-outline-variant ${cls}`} strokeWidth="1.75" markerEnd="url(#hd-arrow)" />
}

function HeroDiagram() {
  const [n, setN] = useState(0)
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined
    const t = setTimeout(() => {
      let i = 0
      id = setInterval(() => { i += 1; setN(i); if (i >= 7 && id) clearInterval(id) }, 260)
    }, 450)
    return () => { clearTimeout(t); if (id) clearInterval(id) }
  }, [])
  const cls = (step: number, dir: 'up' | 'left' | 'right' = 'up') => (n >= step ? `fx-${dir}` : 'fx-pre')
  const fade = (step: number) => (n >= step ? 'fx-fade' : 'fx-pre')
  return (
    <svg viewBox="0 0 400 196" className="w-full max-w-[440px] select-none" role="img" aria-label="GTM flywheel: buying signals feed the Outbound and Content engines; outcomes feed a reward loop that tunes the fleet">
      <defs>
        <marker id="hd-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" className="fill-outline-variant" />
        </marker>
      </defs>
      <DiagBar x={30} y={6} w={290} label="BUYING SIGNALS" cls={cls(1)} />
      <DiagDown x={175} y1={40} y2={62} cls={cls(2)} />
      <DiagBar x={30} y={66} w={140} label="OUTBOUND" accent="primary" cls={cls(3, 'left')} />
      <DiagBar x={180} y={66} w={140} label="CONTENT" accent="tertiary" cls={cls(3, 'right')} />
      <DiagDown x={100} y1={100} y2={122} cls={cls(4)} />
      <DiagDown x={250} y1={100} y2={122} cls={cls(4)} />
      <DiagBar x={30} y={126} w={290} label="OUTCOMES -> REWARD LOOP" accent="primary" cls={cls(5)} />
      <path d="M 320 143 C 356 143, 356 23, 322 23" fill="none" strokeWidth="1.75" className={`stroke-outline-variant ${cls(6, 'right')}`} markerEnd="url(#hd-arrow)" />
      <text x="380" y="84" textAnchor="middle" transform="rotate(90 380 84)" className={`fill-on-surface-variant ${fade(7)}`} style={{ fontFamily: 'var(--font-label-mono)', fontSize: 7.5, letterSpacing: 1.5 }}>TUNES THE FLEET</text>
    </svg>
  )
}

/* --- 02 The loops ---------------------------------------------- */

type LoopStep = { n: string; action: string; name: string }

const OUTBOUND_LOOP: LoopStep[] = [
  { n: '01', action: 'Monitor',    name: 'Buying Signals' },
  { n: '02', action: 'Match',      name: 'ICP Fit' },
  { n: '03', action: 'Score',      name: 'Lead Priority' },
  { n: '04', action: 'Enrich',     name: 'Contacts' },
  { n: '05', action: 'Guard',      name: 'Deliverability' },
  { n: '06', action: 'Draft',      name: 'Outreach' },
  { n: '07', action: 'Send',       name: 'Reply Triage' },
  { n: '08', action: 'Convert',    name: 'Book & Follow' },
]

const CONTENT_LOOP: LoopStep[] = [
  { n: '01', action: 'Ideate',    name: 'Angles' },
  { n: '02', action: 'Write',     name: 'Per Platform' },
  { n: '03', action: 'Edit',      name: 'Brand Voice' },
  { n: '04', action: 'Schedule',  name: 'Calendar' },
  { n: '05', action: 'Publish',   name: 'LinkedIn & X' },
  { n: '06', action: 'Measure',   name: 'Engagement' },
  { n: '07', action: 'Learn',     name: 'What Works' },
  { n: '08', action: 'Repurpose', name: 'Winners' },
]

function LoopGrid({ id, title, badge, steps, dark }: { id?: string; title: string; badge: string; steps: LoopStep[]; dark?: boolean }) {
  return (
    <section id={id} className={`${dark ? '' : 'bg-surface-container-low'} py-24 md:py-32 border-y border-outline-variant/30`}>
      <div className="max-w-[1280px] mx-auto px-margin-page">
        <div className="flex justify-between items-end mb-stack-lg border-b border-outline-variant/30 pb-stack-md">
          <h2 className="font-h1-editorial text-h1-editorial">{title}</h2>
          <span className="font-label-mono text-label-mono text-on-surface-variant uppercase">{badge}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-px bg-outline-variant/30 border border-outline-variant/30">
          {steps.map((s) => (
            <div key={s.n} className="bg-surface p-stack-md min-h-[152px] flex flex-col hover:bg-surface-container-lowest transition-colors cursor-default">
              <span className="font-label-mono text-label-mono text-primary">{s.n}</span>
              <div className="mt-auto">
                <div className="text-primary font-label-mono text-[11px] tracking-[0.1em] mb-1 uppercase">{s.action}</div>
                <div className="text-[15px] text-on-surface font-medium leading-tight whitespace-nowrap">{s.name}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function TheLoop() {
  return (
    <>
      <LoopGrid id="loop" title="The Outbound loop" badge="E2E autonomous pipeline" steps={OUTBOUND_LOOP} />
      <LoopGrid id="content-loop" title="The Content loop" badge="LinkedIn & X · always-on" steps={CONTENT_LOOP} dark />
    </>
  )
}

/* --- 03 For Teams ---------------------------------------------- */

const SIGNAL_FEED: Array<{ t: string; tag: string; tone: 'primary' | 'tertiary'; text: string; status: string; highlight?: boolean }> = [
  { t: '12:04:11', tag: 'Hire',    tone: 'primary',  text: 'Stripe just hired a VP of Growth in London…', status: 'Match [98%]' },
  { t: '12:03:55', tag: 'Fund',    tone: 'tertiary', text: 'Retool raised $45M Series C (Crunchbase)…', status: 'Researching…' },
  { t: '12:01:22', tag: 'Podcast', tone: 'primary',  text: "CTO of Ramp mentioned 'Efficiency' on Acquired…", status: 'Crafting' },
  { t: '11:59:04', tag: 'Sent',    tone: 'primary',  text: 'Re: Strategic Headcount for Ramp', status: 'Outbound', highlight: true },
]

function ForTeams() {
  return (
    <section id="teams" className="max-w-[1280px] mx-auto px-margin-page py-24 md:py-32 border-t border-outline-variant/30">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-gutter items-center">
        <div className="md:col-span-4">
          <h2 className="font-h1-editorial text-[48px] leading-tight mb-stack-md">For teams</h2>
          <p className="font-body-large text-on-surface-variant mb-stack-lg">Total visibility into why a lead was contacted. Every outreach is backed by a verifiable chain of logic.</p>
          <ul className="space-y-stack-sm">
            {['No black-box AI', 'Verifiable source links', 'Human-in-the-loop ready'].map((t) => (
              <li key={t} className="font-label-mono text-label-mono flex gap-3 items-center uppercase">
                <span className="w-1.5 h-1.5 bg-primary" /> {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="md:col-start-6 md:col-span-7 grid-block panel-soft p-4">
          <div className="flex items-center justify-between border-b border-outline-variant pb-2 mb-4">
            <div className="font-label-mono text-[10px] text-outline flex items-center gap-2 uppercase tracking-wider">
              <Icon name="monitor_heart" size={12} /> Live Signal Feed
            </div>
            <div className="flex gap-2">
              <div className="w-2 h-2 rounded-full bg-outline-variant/30" />
              <div className="w-2 h-2 rounded-full bg-outline-variant/30" />
            </div>
          </div>
          <div className="space-y-1">
            {SIGNAL_FEED.map((r) => (
              <div
                key={r.t}
                className={`flex items-center h-10 px-2 gap-4 border-b border-outline-variant/10 transition-colors ${
                  r.highlight ? 'bg-primary/5' : 'hover:bg-surface-container-low'
                }`}
              >
                <span className="font-label-mono text-[10px] text-outline shrink-0">{r.t}</span>
                <span className={`font-label-mono text-[10px] px-1.5 rounded-sm uppercase ${
                  r.tone === 'tertiary' ? 'bg-tertiary-container/10 text-tertiary' : 'bg-primary-container/10 text-primary'
                }`}>{r.tag}</span>
                <span className={`font-body-main truncate ${r.highlight ? 'text-primary' : 'text-on-surface'}`}>{r.text}</span>
                <span className="ml-auto font-label-mono text-[10px] text-primary uppercase shrink-0">{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─── 04 For Agents ───────────────────────────────────────────── */

const AGENT_TOOLS = ['signal', 'enrich', 'match', 'draft', 'send', 'write', 'publish', 'reply'] as const

function AgentDiagram() {
  return (
    <div className="grid-block panel-soft p-stack-lg">
      <svg viewBox="0 0 520 300" className="w-full" role="img" aria-label="Your agent calls the Bombsell API, which exposes GTM steps as tools">
        {/* connectors */}
        <g className="stroke-outline-variant/50" strokeWidth="1.5" fill="none">
          <path d="M120 150 H210" />
          {AGENT_TOOLS.map((_, i) => {
            const y = 36 + i * 33
            return <path key={i} d={`M310 150 C 360 150, 360 ${y}, 408 ${y}`} />
          })}
        </g>
        {/* your agent */}
        <rect x="20" y="124" width="100" height="52" rx="8" className="fill-surface stroke-outline-variant/60" strokeWidth="1" />
        <text x="70" y="147" textAnchor="middle" className="fill-on-surface" style={{ fontFamily: 'var(--font-label-mono)', fontSize: 11 }}>your agent</text>
        <text x="70" y="162" textAnchor="middle" className="fill-on-surface-variant" style={{ fontFamily: 'var(--font-label-mono)', fontSize: 8.5 }}>SDK · REST · MCP</text>
        {/* bombsell api */}
        <rect x="210" y="118" width="100" height="64" rx="10" className="fill-primary" />
        <text x="260" y="146" textAnchor="middle" fill="#fff" style={{ fontFamily: 'var(--font-geist-sans)', fontSize: 15, fontWeight: 700, letterSpacing: -0.3 }}>Bombsell</text>
        <text x="260" y="162" textAnchor="middle" fill="#fff" fillOpacity="0.8" style={{ fontFamily: 'var(--font-label-mono)', fontSize: 8.5, letterSpacing: 1 }}>A2A · 17 AGENTS</text>
        {/* tool pills */}
        {AGENT_TOOLS.map((t, i) => {
          const y = 36 + i * 33
          return (
            <g key={t}>
              <rect x="408" y={y - 12} width="100" height="24" rx="12" className="fill-surface stroke-outline-variant/50" strokeWidth="1" />
              <circle cx="421" cy={y} r="3" className="fill-tertiary" />
              <text x="430" y={y + 3.5} className="fill-on-surface-variant" style={{ fontFamily: 'var(--font-label-mono)', fontSize: 10, letterSpacing: 0.5 }}>{t}</text>
            </g>
          )
        })}
      </svg>
      <p className="mt-stack-sm font-label-mono text-[10px] text-on-surface-variant uppercase tracking-widest">Every GTM step is a tool — call one, a few, or the whole pipeline.</p>
    </div>
  )
}

function ForAgents() {
  return (
    <section id="agents" className="max-w-[1280px] mx-auto px-margin-page py-24 md:py-32">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-gutter items-center">
        <div className="md:col-span-6 order-2 md:order-1">
          <AgentDiagram />
        </div>
        <div className="md:col-start-9 md:col-span-4 order-1 md:order-2">
          <h2 className="font-h1-editorial text-[48px] leading-tight mb-stack-md">For agents</h2>
          <p className="font-body-large text-on-surface-variant mb-stack-lg">GTM as tools your agent can call. Compose your own stack over our fleet — or run the full pipeline. Speaks A2A, REST, and MCP.</p>
          <Link href="/docs" className="font-label-mono text-label-mono text-primary inline-flex items-center gap-2 group uppercase tracking-widest">
            Explore the SDK <Icon name="arrow_forward" className="transition-transform group-hover:translate-x-1" size={16} />
          </Link>
        </div>
      </div>
    </section>
  )
}

/* ─── 05 Integrations ─────────────────────────────────────────── */

const INTEGRATIONS: Array<{ name: string; domain: string }> = [
  { name: 'Gmail',    domain: 'gmail.com' },
  { name: 'Outlook',  domain: 'outlook.com' },
  { name: 'LinkedIn', domain: 'linkedin.com' },
  { name: 'X',        domain: 'x.com' },
  { name: 'Apollo',   domain: 'apollo.io' },
  { name: 'Calendly', domain: 'calendly.com' },
  { name: 'Cal.com',  domain: 'cal.com' },
  { name: 'Slack',    domain: 'slack.com' },
]

function Integrations() {
  return (
    <section id="integrations" className="max-w-[1280px] mx-auto px-margin-page py-24 md:py-32 border-t border-outline-variant/30">
      <div className="text-center mb-stack-lg">
        <h2 className="font-h1-editorial text-[48px] leading-tight mb-stack-md">Works with your stack</h2>
        <p className="font-body-large text-on-surface-variant max-w-2xl mx-auto mb-stack-lg">Connect once — every agent uses what&rsquo;s here. No migrations.</p>
        <span className="font-label-mono text-label-mono text-on-surface-variant uppercase tracking-[0.2em]">Connected today</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-gutter">
        {INTEGRATIONS.map((it) => (
          <div key={it.name} className="bg-surface-container-lowest hairline-border p-6 flex flex-col items-center justify-center gap-3 hover:border-primary/50 transition-colors group cursor-default">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`https://www.google.com/s2/favicons?domain=${it.domain}&sz=64`} alt={`${it.name} logo`} width={24} height={24} className="h-6 w-6 rounded-sm" loading="lazy" />
            <span className="font-label-mono text-label-mono uppercase">{it.name}</span>
          </div>
        ))}
      </div>
      
    </section>
  )
}

/* ─── 06 CTA ──────────────────────────────────────────────────── */

function FinalCta({ loading, onStart }: { loading: boolean; onStart: () => void }) {
  return (
    <section className="bg-surface-container-low border-t border-outline-variant/30">
      <div className="max-w-[1120px] mx-auto px-margin-page py-[120px] md:py-[150px] text-center">
        <p className="font-label-mono text-label-mono uppercase tracking-[0.25em] text-on-surface-variant mb-stack-md">Get started</p>

        <h2 className="font-h1-editorial font-semibold text-on-surface leading-[1.08] tracking-[-0.02em] text-balance">
          <span className="block whitespace-nowrap text-[clamp(1.1rem,4.6vw,3.6rem)]">Stop chasing leads.</span>
          <span className="block text-[clamp(1.25rem,3vw,2.4rem)] text-primary italic">Get Bombsell.</span>
        </h2>

        <p className="font-body-large text-body-large text-on-surface-variant max-w-xl mx-auto mt-stack-lg leading-relaxed">
          Outbound and Content, run by a fleet of agents - composable, on autopilot when you want it. Start free, no card.
        </p>

        <div className="mt-stack-lg flex flex-col sm:flex-row justify-center gap-stack-md">
          <button
            onClick={onStart}
            disabled={loading}
            className="bg-primary text-on-primary px-10 py-4 font-label-mono text-label-mono uppercase tracking-[0.18em] hover:bg-primary-container transition-colors disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Start free'}
          </button>
          <a
            href="mailto:team@bombsell.com?subject=Bombsell%20demo"
            className="border border-outline-variant px-10 py-4 font-label-mono text-label-mono uppercase tracking-[0.18em] text-on-surface hover:border-primary hover:text-primary transition-colors inline-flex items-center justify-center"
          >
            Book a demo
          </a>
        </div>
      </div>
    </section>
  )
}

/* ─── Footer ──────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="border-t border-outline-variant w-full py-section-gap">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-gutter px-margin-page max-w-[1280px] mx-auto">
        <div className="flex flex-col gap-stack-md">
          <div className="font-bold text-[19px] tracking-tight text-on-surface">Bombsell</div>
          <p className="font-body-main text-on-surface-variant max-w-[220px]">© {new Date().getFullYear()} Bombsell.</p>
        </div>
        <FootCol title="Product" links={[['How it works', '#loop'], ['Pricing', '/pricing'], ['Integrations', '#integrations']]} />
        <FootCol title="Developers" links={[['API Docs', '/docs'], ['SDK Reference', '/docs'], ['Status', '/docs']]} />
        <FootCol title="Company" links={[['About', '/'], ['Privacy', '/privacy'], ['Terms', '/terms']]} />
      </div>
    </footer>
  )
}

function FootCol({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div className="flex flex-col gap-4">
      <span className="font-label-mono text-label-mono uppercase text-outline">{title}</span>
      {links.map(([t, h]) => (
        <Link key={t} href={h} className="font-body-main text-on-surface-variant hover:underline">{t}</Link>
      ))}
    </div>
  )
}

/* ─── helpers ─────────────────────────────────────────────────── */

function normalize(input: string): string | null {
  const v = (input ?? '').trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return v
  return `https://${v}`
}
