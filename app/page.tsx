'use client'

import Link from 'next/link'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Icon from '@/components/Icon'

/**
 * Bombsell landing — editorial, command-led. Mirrors the Stitch
 * "Bombsell — Landing Page Updated" composition:
 *   nav · hero + command bar · The Loop (8 cells) · For Agents (SDK)
 *   · For Founders (live signal feed) · Integration Partners · CTA · footer
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
    <div className="min-h-screen flex flex-col bg-surface font-body-main text-on-surface">
      <TopNav loading={loading} onStart={() => void startWith()} />

      <main className="flex-1 pt-32">
        <Hero
          website={website}
          setWebsite={setWebsite}
          loading={loading}
          err={err}
          onSubmit={() => void startWith(website)}
        />
        <TheLoop />
        <ForAgents />
        <ForFounders />
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
    ['The Loop', '#loop', true],
    ['For agents', '#agents', false],
    ['For founders', '#founders', false],
    ['Integrations', '#integrations', false],
    ['Docs', '/docs', false],
  ]
  return (
    <header className="fixed top-0 w-full z-50 bg-surface border-b border-outline-variant/30">
      <nav className="flex justify-between items-center h-16 px-margin-page max-w-[1280px] mx-auto">
        <Link href="/" className="font-h1-editorial text-h1-editorial italic text-on-surface">Bombsell</Link>
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
    <section className="max-w-[1280px] mx-auto px-margin-page py-section-gap">
      <div className="max-w-4xl">
        <h1 className="font-h1-editorial text-[64px] leading-tight mb-stack-lg text-on-surface">
          Sell to the right account at the right moment, <span className="text-primary italic">automatically.</span>
        </h1>

        <form
          onSubmit={(e) => { e.preventDefault(); onSubmit() }}
          className="relative max-w-2xl mt-12 group"
        >
          <div className="bg-surface-container-lowest hairline-border p-stack-sm flex items-center gap-stack-md shadow-sm">
            <Icon name="search" className="text-on-surface-variant ml-2" />
            <input
              className="flex-grow bg-transparent border-none focus:ring-0 font-body-large text-body-large placeholder:text-outline outline-none"
              placeholder="Enter your company URL to see the loop in action…"
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
              {loading ? 'Loading…' : 'Analyze'}
            </button>
          </div>
        </form>

        <div className="mt-stack-md flex gap-stack-lg items-center text-on-surface-variant">
          <span className="font-label-mono text-label-mono flex items-center gap-2 uppercase">
            <Icon name="check_circle" size={14} /> No list-building
          </span>
          <span className="font-label-mono text-label-mono flex items-center gap-2 uppercase">
            <Icon name="check_circle" size={14} /> Zero manual reachout
          </span>
        </div>
        {err && <p className="mt-3 font-label-mono text-label-mono text-error">{err}</p>}
      </div>
    </section>
  )
}

/* ─── 02 The Loop ─────────────────────────────────────────────── */

const LOOP_STEPS: Array<{ n: string; action: string; name: string }> = [
  { n: '01', action: 'Monitor',    name: 'Signal' },
  { n: '02', action: 'Validate',   name: 'ICP Matching' },
  { n: '03', action: 'Prioritize', name: 'Lead Scoring' },
  { n: '04', action: 'Craft',      name: 'Personalized Drafting' },
  { n: '05', action: 'Compliance', name: 'Verified Contacts' },
  { n: '06', action: 'Execute',    name: 'Send' },
  { n: '07', action: 'Convert',    name: 'Calendar Sync' },
  { n: '08', action: 'Optimize',   name: 'Reward Loop' },
]

function TheLoop() {
  return (
    <section id="loop" className="bg-surface-container-low py-section-gap border-y border-outline-variant/30">
      <div className="max-w-[1280px] mx-auto px-margin-page">
        <div className="flex justify-between items-end mb-stack-lg border-b border-outline-variant/30 pb-stack-md">
          <h2 className="font-h1-editorial text-h1-editorial">The Loop</h2>
          <span className="font-label-mono text-label-mono text-on-surface-variant uppercase">E2E Autonomous Pipeline</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-px bg-outline-variant/30 border border-outline-variant/30">
          {LOOP_STEPS.map((s) => (
            <div key={s.n} className="bg-surface p-stack-md aspect-square flex flex-col justify-between hover:bg-surface-container-lowest transition-colors cursor-default">
              <span className="font-label-mono text-label-mono text-primary">{s.n}</span>
              <div>
                <div className="text-primary font-label-mono text-label-mono mb-1 uppercase">{s.action}</div>
                <div className="font-body-main text-on-surface font-medium">{s.name}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── 03 For Founders ─────────────────────────────────────────── */

const SIGNAL_FEED: Array<{ t: string; tag: string; tone: 'primary' | 'tertiary'; text: string; status: string; highlight?: boolean }> = [
  { t: '12:04:11', tag: 'Hire',    tone: 'primary',  text: 'Stripe just hired a VP of Growth in London…', status: 'Match [98%]' },
  { t: '12:03:55', tag: 'Fund',    tone: 'tertiary', text: 'Retool raised $45M Series C (Crunchbase)…', status: 'Researching…' },
  { t: '12:01:22', tag: 'Podcast', tone: 'primary',  text: "CTO of Ramp mentioned 'Efficiency' on Acquired…", status: 'Crafting' },
  { t: '11:59:04', tag: 'Sent',    tone: 'primary',  text: 'Re: Strategic Headcount for Ramp', status: 'Outbound', highlight: true },
]

function ForFounders() {
  return (
    <section id="founders" className="max-w-[1280px] mx-auto px-margin-page py-section-gap border-t border-outline-variant/30">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-gutter items-center">
        <div className="md:col-span-4">
          <h2 className="font-h1-editorial text-[48px] leading-tight mb-stack-md">For Founders</h2>
          <p className="font-body-large text-on-surface-variant mb-stack-lg">Total visibility into why a lead was contacted. Every outreach is backed by a verifiable chain of logic.</p>
          <ul className="space-y-stack-sm">
            {['No black box AI', 'Verifiable source links', 'Human-in-the-loop ready'].map((t) => (
              <li key={t} className="font-label-mono text-label-mono flex gap-3 items-center uppercase">
                <span className="w-1.5 h-1.5 bg-primary" /> {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="md:col-span-8 bg-surface-container-lowest hairline-border p-4">
          <div className="flex items-center justify-between border-b border-outline-variant pb-2 mb-4">
            <div className="font-label-mono text-[10px] text-outline flex items-center gap-2 uppercase tracking-tight">
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

const AGENT_CODE: Array<Array<{ t: string; c?: 'kw' | 'str' | 'com' }>> = [
  [{ t: 'from', c: 'kw' }, { t: ' bombsell ' }, { t: 'import', c: 'kw' }, { t: ' Loop, Agent' }],
  [],
  [{ t: '# Initialize the Bombsell Fleet', c: 'com' }],
  [{ t: 'loop = Loop(api_key=' }, { t: '"BS_882…"', c: 'str' }, { t: ')' }],
  [],
  [{ t: '# Deploy a custom Research Agent', c: 'com' }],
  [{ t: 'loop.deploy(' }],
  [{ t: '    Agent(' }],
  [{ t: '        role=' }, { t: '"ContextScraper"', c: 'str' }, { t: ',' }],
  [{ t: '        sources=[' }, { t: '"sec.gov"', c: 'str' }, { t: ', ' }, { t: '"linkedin"', c: 'str' }, { t: ', ' }, { t: '"spotify"', c: 'str' }, { t: '],' }],
  [{ t: '        logic=' }, { t: '"extract_growth_painpoints"', c: 'str' }],
  [{ t: '    )' }],
  [{ t: ')' }],
  [],
  [{ t: 'loop.run(trigger=' }, { t: '"headcount_change > 0.15"', c: 'str' }, { t: ')' }],
]

function CodeBlock() {
  const tone = { kw: 'text-primary-fixed-dim', str: 'text-tertiary-fixed-dim', com: 'text-white/40' }
  return (
    <pre className="leading-relaxed overflow-x-auto">
      {AGENT_CODE.map((line, i) => (
        <div key={i}>
          {line.length === 0 ? ' ' : line.map((tk, j) => (
            <span key={j} className={tk.c ? tone[tk.c] : undefined}>{tk.t}</span>
          ))}
        </div>
      ))}
    </pre>
  )
}

function ForAgents() {
  return (
    <section id="agents" className="max-w-[1280px] mx-auto px-margin-page py-section-gap">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-gutter items-center">
        <div className="md:col-span-7 order-2 md:order-1">
          <div className="bg-[#1A1816] rounded-lg p-stack-md font-label-mono text-[12px] text-surface overflow-hidden hairline-border">
            <div className="flex gap-2 mb-4 border-b border-white/10 pb-2">
              <div className="w-3 h-3 rounded-full bg-white/20" />
              <div className="w-3 h-3 rounded-full bg-white/20" />
              <div className="w-3 h-3 rounded-full bg-white/20" />
              <span className="ml-4 text-white/40">src/agents/outbound_loop.py</span>
            </div>
            <CodeBlock />
          </div>
        </div>
        <div className="md:col-span-5 order-1 md:order-2">
          <h2 className="font-h1-editorial text-[48px] leading-tight mb-stack-md">For Agents</h2>
          <p className="font-body-large text-on-surface-variant mb-stack-lg">Built for the agentic era. Integrate our fleet via SDK or deploy your own custom logic into the loop.</p>
          <Link href="/docs" className="font-label-mono text-label-mono text-primary inline-flex items-center gap-2 group uppercase tracking-widest">
            Explore the SDK <Icon name="arrow_forward" className="transition-transform group-hover:translate-x-1" size={16} />
          </Link>
        </div>
      </div>
    </section>
  )
}

/* ─── 05 Integrations ─────────────────────────────────────────── */

const INTEGRATIONS: Array<{ name: string; icon: string }> = [
  { name: 'Salesforce', icon: 'hub' },
  { name: 'Hubspot',    icon: 'filter_alt' },
  { name: 'Slack',      icon: 'forum' },
  { name: 'Apollo',     icon: 'rocket_launch' },
  { name: 'Clay',       icon: 'layers' },
  { name: 'Outreach',   icon: 'mail' },
  { name: 'Segment',    icon: 'dataset' },
]

function Integrations() {
  return (
    <section id="integrations" className="max-w-[1280px] mx-auto px-margin-page py-section-gap border-t border-outline-variant/30">
      <div className="text-center mb-stack-lg">
        <h2 className="font-h1-editorial text-[48px] leading-tight mb-stack-md">Integration Partners</h2>
        <p className="font-body-large text-on-surface-variant max-w-2xl mx-auto mb-stack-lg">Sync your autonomous pipeline with the tools your team already uses. No messy migrations, just seamless data flow.</p>
        <span className="font-label-mono text-label-mono text-on-surface-variant uppercase tracking-[0.2em]">Supported Ecosystem</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-gutter">
        {INTEGRATIONS.map((it) => (
          <div key={it.name} className="bg-surface-container-lowest hairline-border p-6 flex flex-col items-center justify-center gap-3 hover:border-primary transition-colors group cursor-pointer">
            <Icon name={it.icon} size={32} className="text-outline group-hover:text-primary" />
            <span className="font-label-mono text-label-mono uppercase">{it.name}</span>
          </div>
        ))}
      </div>
      <div className="mt-stack-lg text-center">
        <Link href="/docs" className="font-label-mono text-label-mono text-primary inline-flex items-center gap-2 mx-auto group uppercase tracking-widest">
          View all 50+ integrations <Icon name="arrow_forward" className="transition-transform group-hover:translate-x-1" size={16} />
        </Link>
      </div>
    </section>
  )
}

/* ─── 06 CTA ──────────────────────────────────────────────────── */

function FinalCta({ loading, onStart }: { loading: boolean; onStart: () => void }) {
  return (
    <section className="bg-surface py-[120px] border-t border-outline-variant/30 text-center">
      <div className="max-w-4xl mx-auto px-margin-page">
        <h2 className="font-h1-editorial text-[72px] leading-[0.95] mb-stack-lg text-on-surface">
          Stop chasing leads.<br /><span className="italic text-primary">Run the loop.</span>
        </h2>
        <div className="flex flex-col md:flex-row justify-center gap-stack-md mt-12">
          <button
            onClick={onStart}
            disabled={loading}
            className="bg-primary text-on-primary px-12 py-4 font-label-mono text-label-mono uppercase tracking-[0.1em] hover:bg-primary-container transition-colors disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Start Your Free Loop'}
          </button>
          <Link href="/pricing" className="bg-surface-container-lowest hairline-border px-12 py-4 font-label-mono text-label-mono uppercase tracking-[0.1em] hover:bg-surface-container-low transition-colors inline-flex items-center justify-center">
            Book a Demo
          </Link>
        </div>
        <p className="mt-stack-lg font-caption text-caption text-on-surface-variant">No credit card required. Up and running in 15 minutes.</p>
      </div>
    </section>
  )
}

/* ─── Footer ──────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="bg-surface-container-high border-t border-outline-variant w-full py-section-gap">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-gutter px-margin-page max-w-[1280px] mx-auto">
        <div className="flex flex-col gap-stack-md">
          <div className="font-h1-editorial text-h1-editorial italic text-on-surface">Bombsell</div>
          <p className="font-body-main text-on-surface-variant max-w-[220px]">© {new Date().getFullYear()} Bombsell GTM. Built for the agentic era.</p>
        </div>
        <FootCol title="Product" links={[['The Loop', '#loop'], ['Pricing', '/pricing'], ['Integrations', '#integrations']]} />
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
