'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Icon from '@/components/Icon'
import { useToast } from '@/components/Toast'

/**
 * Bombsell landing — editorial, command-led. Mirrors the Stitch
 * "Bombsell — Landing Page Updated" composition:
 *   nav · hero + command bar · The Loop (8 cells) · For Agents (SDK)
 *   · For Teams (live signal feed) · Integration Partners · CTA · footer
 */
export default function LandingPage() {
  const [loading, setLoading] = useState(false)
  const [website, setWebsite] = useState('')
  const toast = useToast()

  async function startWith(prefill?: string) {
    setLoading(true)
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
    if (error) { toast.error(error.message); setLoading(false) }
  }

  return (
    <div className="page-grid min-h-screen flex flex-col bg-surface font-body-main text-on-surface">
      <TopNav loading={loading} onStart={() => void startWith()} />

      <main className="flex-1">
        <Hero
          website={website}
          setWebsite={setWebsite}
          loading={loading}
          onSubmit={() => void startWith(website)}
        />
        <TheLoop />
        <WorkflowShowcase />
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
    ['Workflows', '#workflows', true],
    ['How it works', '#loop', false],
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
  website, setWebsite, loading, onSubmit,
}: {
  website: string; setWebsite: (s: string) => void;
  loading: boolean; onSubmit: () => void;
}) {
  return (
    <section className="relative overflow-hidden hero-bg pt-32">
      {/* Decorative depth layer — sits behind everything */}
      <div aria-hidden className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        <span className="float-orb orb-primary drift-slow" style={{ width: 520, height: 520, top: -120, left: '8%' }} />
        <span className="float-orb orb-tertiary" style={{ width: 420, height: 420, top: 40, right: '6%' }} />
        <span className="float-orb orb-soft drift-slower" style={{ width: 640, height: 640, top: 260, left: '38%' }} />
      </div>
      <div className="relative max-w-[1280px] mx-auto px-margin-page pt-stack-lg pb-section-gap" style={{ zIndex: 1 }}>
      <div className="max-w-[1120px] mx-auto text-center">
        <p className="reveal font-label-mono text-label-mono uppercase tracking-[0.2em] text-on-surface-variant mb-stack-md">Agentic GTM</p>

        <h1 className="reveal reveal-1 font-h1-editorial font-semibold text-on-surface leading-[1.08] tracking-[-0.02em] text-balance">
          <span className="block sm:whitespace-nowrap text-[clamp(1.75rem,6vw,3.6rem)]">Building the Future GTM stack</span>
          <span className="block text-[clamp(1.1rem,2.8vw,1.6rem)] pt-3 sm:pt-4 text-primary italic">Pay for outcomes, not seats.</span>
        </h1>

        <br></br>
        <p className="reveal reveal-2 font-body-large text-body-large text-on-surface-variant max-w-2xl mx-auto mt-stack-lg leading-relaxed">
          A fleet of agents running outbound, content and campaigns - 24/7.
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); onSubmit() }}
          className="reveal reveal-3 relative max-w-xl mx-auto mt-stack-lg group"
        >
          {/* Offset card behind input — abstracts the form forward */}
          <span aria-hidden className="absolute inset-0 hairline-border bg-surface-container-low/80 -z-10" style={{ transform: 'translate(8px, 10px) rotate(0.4deg)' }} />
          <div className="relative bg-surface-container-lowest hairline-border p-stack-sm flex flex-col sm:flex-row items-stretch sm:items-center gap-stack-sm sm:gap-stack-md depth-stack text-left">
            <div className="flex items-center gap-stack-md flex-grow min-w-0">
              <Icon name="search" className="text-on-surface-variant ml-2 shrink-0" />
              <input
                className="flex-grow min-w-0 bg-transparent border-none focus:ring-0 font-body-large text-body-large placeholder:text-outline outline-none"
                placeholder="Enter your company URL"
                type="text"
                inputMode="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                aria-label="Your company URL"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="shrink-0 bg-primary text-on-primary px-stack-md py-stack-sm font-label-mono text-label-mono uppercase tracking-widest hover:bg-primary-container transition-colors disabled:opacity-60"
            >
              {loading ? 'Loading...' : 'Get Started'}
            </button>
          </div>
        </form>
      </div>

      <div className="mt-section-gap flex justify-center">
        <div className="reveal reveal-2 relative max-w-[760px] w-full">
          <HeroDiagram />
        </div>
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

/* --- Hero illustration: chain-assembly pipeline (SIGNAL → ENGINES → DRAFT → OUTCOMES + reward loop) --- */

const HERO_SIGNALS: Array<{ tag: string; text: string; accent: 'primary' | 'tertiary' }> = [
  { tag: 'HIRE',    text: 'Stripe · VP Growth',  accent: 'primary' },
  { tag: 'FUND',    text: 'Retool · $45M C',     accent: 'tertiary' },
  { tag: 'LAUNCH',  text: 'Linear · v2 ships',   accent: 'primary' },
  { tag: 'PODCAST', text: 'Ramp · Acquired',     accent: 'tertiary' },
  { tag: 'CHURN',   text: 'Competitor · price',  accent: 'primary' },
]

function HeroDiagram() {
  const [active, setActive] = useState(0)
  const [sigIdx, setSigIdx] = useState(0)

  useEffect(() => {
    const e = setInterval(() => setActive(v => (v + 1) % 3), 1800)
    const s = setInterval(() => setSigIdx(v => (v + 1) % HERO_SIGNALS.length), 2400)
    return () => { clearInterval(e); clearInterval(s) }
  }, [])

  const sigA = HERO_SIGNALS[sigIdx]
  const sigB = HERO_SIGNALS[(sigIdx + 1) % HERO_SIGNALS.length]
  const engineLabels: Array<{ name: string; accent: 'primary' | 'tertiary' }> = [
    { name: 'OUTBOUND',  accent: 'primary' },
    { name: 'CONTENT',   accent: 'tertiary' },
    { name: 'CAMPAIGNS', accent: 'primary' },
  ]

  return (
    <svg viewBox="0 0 800 400" className="w-full select-none" role="img" aria-label="Bombsell pipeline: signal feeds engines that produce drafts and outcomes; reward loop tunes the fleet">
      <defs>
        <marker id="hd-tip" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="var(--color-primary)" />
        </marker>
        <pattern id="hd-grid" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.9" className="fill-outline-variant/25" />
        </pattern>
        {/* tile gradients — gentle diagonal warm shifts */}
        <linearGradient id="hd-bg-1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-surface-container-lowest)" />
          <stop offset="1" stopColor="var(--color-surface-container-low)" />
        </linearGradient>
        <linearGradient id="hd-bg-2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-surface-container-low)" />
          <stop offset="1" stopColor="var(--color-surface-container)" />
        </linearGradient>
        <linearGradient id="hd-bg-3" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-surface-container)" />
          <stop offset="1" stopColor="var(--color-surface-container-high)" />
        </linearGradient>
        <linearGradient id="hd-bg-4" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-surface-container-lowest)" />
          <stop offset="0.6" stopColor="var(--color-surface-container-lowest)" />
          <stop offset="1" stopColor="var(--color-surface-container-low)" />
        </linearGradient>
        {/* top-edge inner highlight — fakes light catching the top */}
        <linearGradient id="hd-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.4" />
          <stop offset="0.18" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Backdrop dotted field */}
      <rect className="hd-soft hd-d-0" x="0" y="0" width="800" height="400" fill="url(#hd-grid)" />

      {/* ───── TILE 01: SIGNAL — soft peach (primary-fixed), slides from far left ───── */}
      <g className="hd-anim hd-glide-l hd-d-1">
        <rect x={20} y={70} width={170} height={172} rx={16} fill="url(#hd-bg-1)" stroke="var(--color-outline-variant)" strokeWidth="1" strokeOpacity="0.7" />
        <text x={44} y={102} className="fill-primary" style={{ fontFamily: 'var(--font-label-mono)', fontSize: 11, letterSpacing: 2, opacity: 0.8 }}>01</text>
        <text x={44} y={134} className="fill-on-surface" style={{ fontFamily: 'var(--font-h1-editorial)', fontSize: 26, letterSpacing: -0.5, fontWeight: 600 }}>SIGNAL</text>
        <g>
          <circle cx={160} cy={92} r={3.5} className="fill-primary">
            <animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite" />
          </circle>
          <text x={150} y={96} textAnchor="end" className="fill-primary" style={{ fontFamily: 'var(--font-label-mono)', fontSize: 9, letterSpacing: 1.4 }}>LIVE</text>
        </g>
        <line x1={44} y1={148} x2={166} y2={148} stroke="var(--color-on-surface)" strokeWidth="0.75" opacity={0.18} />
        <g key={`sig-${sigIdx}`} className="hd-soft">
          <text x={44} y={168} className="fill-primary" style={{ fontFamily: 'var(--font-label-mono)', fontSize: 9, letterSpacing: 1.4, opacity: 0.85 }}>{sigA.tag}</text>
          <text x={44} y={184} className="fill-on-surface" style={{ fontFamily: 'var(--font-label-mono)', fontSize: 10, letterSpacing: 0.3 }}>{sigA.text}</text>
          <text x={44} y={204} className="fill-on-surface-variant" style={{ fontFamily: 'var(--font-label-mono)', fontSize: 9, letterSpacing: 0.8, opacity: 0.7 }}>▸ {sigB.tag}</text>
        </g>
      </g>

      {/* Connector A */}
      <line className="hd-link hd-d-2" pathLength="100" x1={196} y1={145} x2={216} y2={145} stroke="var(--color-on-surface-variant)" strokeWidth="1.75" strokeLinecap="round" markerEnd="url(#hd-tip)" opacity={0.7} />

      {/* ───── TILE 02: ENGINES — warm beige (surface-container-high), drops from top ───── */}
      <g className="hd-anim hd-glide-u hd-d-3">
        <rect x={220} y={70} width={170} height={172} rx={16} fill="url(#hd-bg-2)" stroke="var(--color-outline-variant)" strokeWidth="1" strokeOpacity="0.7" />
        <text x={244} y={102} className="fill-on-surface-variant" style={{ fontFamily: 'var(--font-label-mono)', fontSize: 11, letterSpacing: 2, opacity: 0.7 }}>02</text>
        <text x={244} y={134} className="fill-on-surface" style={{ fontFamily: 'var(--font-h1-editorial)', fontSize: 24, letterSpacing: -0.5, fontWeight: 600 }}>ENGINES</text>
        {engineLabels.map((eng, i) => {
          const isActive = active === i
          const ac = eng.accent
          const y = 152 + i * 20
          const strokeCls = isActive ? (ac === 'primary' ? 'stroke-primary' : 'stroke-tertiary') : 'stroke-outline-variant/30'
          const textCls = isActive ? (ac === 'primary' ? 'fill-primary' : 'fill-tertiary') : 'fill-on-surface-variant'
          const dotCls = ac === 'primary' ? 'fill-primary' : 'fill-tertiary'
          return (
            <g key={eng.name}>
              <rect x={244} y={y} width={122} height={16} rx={5} className={`fill-surface-container-lowest ${strokeCls}`} strokeWidth={isActive ? 1.4 : 1} />
              <circle cx={256} cy={y + 8} r={2.4} className={dotCls} opacity={isActive ? 1 : 0.35}>
                {isActive && <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />}
              </circle>
              <text x={268} y={y + 12} className={textCls} style={{ fontFamily: 'var(--font-label-mono)', fontSize: 9.5, letterSpacing: 1.4, fontWeight: isActive ? 600 : 400 }}>{eng.name}</text>
            </g>
          )
        })}
      </g>

      {/* Connector B */}
      <line className="hd-link hd-d-4" pathLength="100" x1={396} y1={145} x2={416} y2={145} stroke="var(--color-on-surface-variant)" strokeWidth="1.75" strokeLinecap="round" markerEnd="url(#hd-tip)" opacity={0.7} />

      {/* ───── TILE 03: DRAFT — soft mint (tertiary-fixed), rises from bottom ───── */}
      <g className="hd-anim hd-glide-d hd-d-5">
        <rect x={420} y={70} width={170} height={172} rx={16} fill="url(#hd-bg-3)" stroke="var(--color-outline-variant)" strokeWidth="1" strokeOpacity="0.7" />
        <text x={444} y={102} className="fill-tertiary" style={{ fontFamily: 'var(--font-label-mono)', fontSize: 11, letterSpacing: 2, opacity: 0.85 }}>03</text>
        <text x={444} y={134} className="fill-on-surface" style={{ fontFamily: 'var(--font-h1-editorial)', fontSize: 26, letterSpacing: -0.5, fontWeight: 600 }}>DRAFT</text>
        <line x1={444} y1={148} x2={566} y2={148} stroke="var(--color-on-surface)" strokeWidth="0.75" opacity={0.18} />
        <rect x={444} y={158} width={118} height={3} rx={1.5} className="fill-on-surface" opacity={0.55} />
        <rect x={444} y={168} width={96}  height={2.5} rx={1.25} className="fill-on-surface" opacity={0.35} />
        <rect x={444} y={176} width={108} height={2.5} rx={1.25} className="fill-on-surface" opacity={0.35} />
        <rect x={444} y={184} width={78}  height={2.5} rx={1.25} className="fill-on-surface" opacity={0.35} />
        <rect x={444} y={192} width={58}  height={2.5} rx={1.25} className="fill-on-surface" opacity={0.25} />
        <rect x={444} y={202} width={102} height={14} rx={4} className="fill-primary" opacity={0.92} />
        <text x={450} y={212} className="fill-on-primary" style={{ fontFamily: 'var(--font-label-mono)', fontSize: 9, letterSpacing: 1.4 }}>READY · 84/100</text>
      </g>

      {/* Connector C */}
      <line className="hd-link hd-d-6" pathLength="100" x1={596} y1={145} x2={616} y2={145} stroke="var(--color-on-surface-variant)" strokeWidth="1.75" strokeLinecap="round" markerEnd="url(#hd-tip)" opacity={0.7} />

      {/* ───── TILE 04: OUTCOMES — soft outline, slides from far right ───── */}
      <g className="hd-anim hd-glide-r hd-d-7">
        <rect x={620} y={70} width={160} height={172} rx={16} fill="url(#hd-bg-4)" stroke="var(--color-outline-variant)" strokeWidth="1" strokeOpacity="0.7" />
        <text x={644} y={102} className="fill-on-surface-variant" style={{ fontFamily: 'var(--font-label-mono)', fontSize: 11, letterSpacing: 2, opacity: 0.7 }}>04</text>
        <text x={644} y={134} className="fill-on-surface" style={{ fontFamily: 'var(--font-h1-editorial)', fontSize: 19, letterSpacing: -0.4, fontWeight: 600 }}>OUTCOMES</text>
        {([
          { label: 'SENT',   value: '124', pct: 0.85, fill: 'fill-on-surface',  bar: 'fill-on-surface' },
          { label: 'REPLY',  value: '42',  pct: 0.42, fill: 'fill-primary',     bar: 'fill-primary' },
          { label: 'BOOKED', value: '11',  pct: 0.18, fill: 'fill-tertiary',    bar: 'fill-tertiary' },
        ]).map((m, i) => {
          const y = 158 + i * 22
          const w = 112
          return (
            <g key={m.label}>
              <text x={644} y={y} className="fill-on-surface-variant" style={{ fontFamily: 'var(--font-label-mono)', fontSize: 9, letterSpacing: 1.2 }}>{m.label}</text>
              <text x={756} y={y} textAnchor="end" className={m.fill} style={{ fontFamily: 'var(--font-label-mono)', fontSize: 13, letterSpacing: 0.5, fontWeight: 700 }}>{m.value}</text>
              <rect x={644} y={y + 5} width={w} height={3} rx={1.5} className="fill-outline-variant/35" />
              <rect x={644} y={y + 5} width={0} height={3} rx={1.5} className={m.bar}>
                <animate attributeName="width" from="0" to={w * m.pct} dur="1s" begin="2.05s" fill="freeze" />
              </rect>
            </g>
          )
        })}
      </g>

      {/* ───── Reward loop arc beneath ───── */}
      <g className="hd-arc hd-d-9">
        <path id="hd-loop-path" d="M 720 272 Q 400 376 80 272" fill="none" stroke="var(--color-on-surface-variant)" strokeWidth="1.25" strokeDasharray="3 6" strokeLinecap="round" markerEnd="url(#hd-tip)" opacity={0.45} />
      </g>
      <g className="hd-soft hd-d-10">
        <circle r={4.5} className="fill-primary">
          <animateMotion dur="5.4s" repeatCount="indefinite" begin="2.8s">
            <mpath href="#hd-loop-path" />
          </animateMotion>
          <animate attributeName="opacity" values="0.5;1;0.5" dur="5.4s" repeatCount="indefinite" begin="2.8s" />
        </circle>
        <text x={400} y={390} textAnchor="middle" className="fill-on-surface-variant" style={{ fontFamily: 'var(--font-label-mono)', fontSize: 11, letterSpacing: 4, opacity: 0.7 }}>REWARD LOOP · TUNES THE FLEET</text>
      </g>
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
            <div key={s.n} className="relative bg-surface p-stack-md min-h-[152px] flex flex-col hover:bg-surface-container-lowest depth-lift cursor-default">
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

/* --- 02b Workflow showcase ------------------------------------- */

type WorkflowRow = {
  id: string
  tag: string
  title: string
  lead: string
  bullets: string[]
  cta: { label: string; href: string }
  mock: 'outbound' | 'content' | 'campaign'
  reverse?: boolean
}

const WORKFLOW_ROWS: WorkflowRow[] = [
  {
    id: 'outbound',
    tag: 'Engine 01 · Outbound',
    title: 'Every send carries its receipts.',
    lead: 'Buying signals become verified contacts, drafted outreach, and reply triage — with the chain of logic the team can defend in a review meeting.',
    bullets: [
      'Live signal feed: hires, funding, podcasts, product launches.',
      'Verified contact with provenance — no guessed emails.',
      'Reply triage routes to booked, follow-up, or stop.',
    ],
    cta: { label: 'See the outbound loop', href: '#loop' },
    mock: 'outbound',
  },
  {
    id: 'content',
    tag: 'Engine 02 · Content',
    title: 'Always-on publishing in your brand voice.',
    lead: 'Ideas tuned to what already worked, drafts written per platform, edits in your voice, scheduled and measured — so the calendar never goes dark.',
    bullets: [
      'Per-platform drafts for LinkedIn and X with brand-voice edits.',
      'A queue that learns which angles convert into replies.',
      'Engagement data feeds back into the next batch.',
    ],
    cta: { label: 'See the content loop', href: '#content-loop' },
    mock: 'content',
    reverse: true,
  },
  {
    id: 'campaigns',
    tag: 'Engine 03 · Campaigns',
    title: 'Triggered motions with air cover.',
    lead: 'Wrap outbound and content into a single motion behind one trigger. Targets, drafts, and companion posts move together — and the learning loop tightens the next batch.',
    bullets: [
      'One trigger orchestrates targets, drafts, and content.',
      'Content air cover supports outbound replies on the same theme.',
      'Outcome data — sent, replied, booked — feeds the next batch.',
    ],
    cta: { label: 'Open a campaign motion', href: '/pricing' },
    mock: 'campaign',
  },
]

function WorkflowShowcase() {
  return (
    <section id="workflows" className="relative max-w-[1280px] mx-auto px-margin-page py-24 md:py-32 border-t border-outline-variant/30">
      <span aria-hidden className="float-orb orb-soft drift-slower" style={{ width: 560, height: 560, top: 80, left: '32%', zIndex: 0 }} />
      <div className="relative" style={{ zIndex: 1 }}>
        <div className="max-w-[760px] mb-section-gap">
          <p className="font-label-mono text-label-mono uppercase tracking-[0.25em] text-on-surface-variant mb-stack-md">Three engines, one fleet</p>
          <h2 className="font-h1-editorial text-[32px] md:text-[52px] leading-[1.05] tracking-[-0.02em]">
            Outbound. Content. Campaigns.
          </h2>
          <p className="font-body-large text-on-surface-variant mt-stack-md max-w-xl">
            Verifiable steps you can audit, hand off, or hand back. Pick one, compose all three.
          </p>
        </div>
        <div className="flex flex-col gap-[clamp(64px,8vw,128px)]">
          {WORKFLOW_ROWS.map(row => <WorkflowRowView key={row.id} row={row} />)}
        </div>
      </div>
    </section>
  )
}

function WorkflowRowView({ row }: { row: WorkflowRow }) {
  return (
    <div id={row.id} className="grid grid-cols-1 md:grid-cols-12 gap-gutter items-center">
      <div className={`md:col-span-5 ${row.reverse ? 'md:order-2 md:col-start-8 md:pl-stack-lg' : ''}`}>
        <p className="font-label-mono text-label-mono uppercase tracking-[0.22em] text-primary mb-stack-md">{row.tag}</p>
        <h3 className="font-h1-editorial text-[26px] md:text-[36px] leading-[1.1] tracking-[-0.015em] mb-stack-md">{row.title}</h3>
        <p className="font-body-large text-on-surface-variant leading-relaxed mb-stack-lg">{row.lead}</p>
        <ul className="space-y-stack-sm mb-stack-lg">
          {row.bullets.map(b => (
            <li key={b} className="flex gap-3 items-start font-body-main text-on-surface">
              <span className="mt-2 w-1.5 h-1.5 bg-primary shrink-0" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <Link href={row.cta.href} className="font-label-mono text-label-mono text-primary inline-flex items-center gap-2 group uppercase tracking-widest">
          {row.cta.label} <Icon name="arrow_forward" className="transition-transform group-hover:translate-x-1" size={16} />
        </Link>
      </div>
      <div className={`md:col-span-6 ${row.reverse ? 'md:order-1 md:col-start-1' : 'md:col-start-7'}`}>
        <WorkflowMock kind={row.mock} />
      </div>
    </div>
  )
}

function WorkflowMock({ kind }: { kind: WorkflowRow['mock'] }) {
  return (
    <div className="layer-stack rounded-lg">
      <span aria-hidden className="layer-back rounded-lg" />
      <span aria-hidden className="layer-back-2 rounded-lg" />
      <div className="layer-front grid-block panel-soft p-stack-md md:p-stack-lg depth-stack">
        {kind === 'outbound' && <OutboundMock />}
        {kind === 'content' && <ContentMock />}
        {kind === 'campaign' && <CampaignMock />}
      </div>
    </div>
  )
}

function MockChrome({ title, badge }: { title: string; badge: string }) {
  return (
    <div className="flex items-center justify-between border-b border-outline-variant/40 pb-2 mb-stack-md">
      <div className="flex items-center gap-2 font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
        <span className="w-1.5 h-1.5 rounded-full bg-primary" /> {title}
      </div>
      <span className="font-label-mono text-[9px] uppercase tracking-widest bg-primary-container/10 text-primary px-1.5 py-0.5 rounded">{badge}</span>
    </div>
  )
}

function StatTile({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'primary' | 'tertiary' }) {
  const valueClass = tone === 'primary' ? 'text-primary' : tone === 'tertiary' ? 'text-tertiary' : 'text-on-surface'
  return (
    <div className="bg-surface-container-lowest hairline-border rounded p-2.5 min-w-0">
      <div className="font-label-mono text-[9px] uppercase tracking-widest text-on-surface-variant">{label}</div>
      <div className={`font-body-main text-[14px] mt-0.5 truncate ${valueClass}`}>{value}</div>
    </div>
  )
}

function OutboundMock() {
  return (
    <div>
      <MockChrome title="Lead drawer · Ramp" badge="Evidence" />
      <div className="grid grid-cols-2 gap-2 mb-stack-md">
        <StatTile label="Trigger" value="VP Growth hire" tone="primary" />
        <StatTile label="Source" value="LinkedIn · 88/100" tone="tertiary" />
        <StatTile label="Signal age" value="2h ago" />
        <StatTile label="Fit" value="9/10 · live" />
      </div>
      <div className="bg-surface-container-lowest hairline-border rounded p-3 mb-stack-md">
        <div className="flex items-center gap-2 mb-2">
          <Icon name="schedule_send" size={16} className="text-primary" />
          <span className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant">Next best action</span>
        </div>
        <div className="font-body-main text-on-surface">Approve and dispatch</div>
        <div className="font-body-main text-on-surface-variant text-[12.5px] mt-1">Recipient verified, evidence linked, draft passed quality gate (84/100).</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-surface-container-lowest hairline-border rounded p-2">
          <div className="font-label-mono text-[9px] uppercase tracking-widest text-on-surface-variant">Subject</div>
          <div className="font-body-main text-[13px] text-on-surface mt-0.5 truncate">Headcount for the new GTM motion</div>
        </div>
        <div className="bg-surface-container-lowest hairline-border rounded p-2">
          <div className="font-label-mono text-[9px] uppercase tracking-widest text-on-surface-variant">CTA</div>
          <div className="font-body-main text-[13px] text-on-surface mt-0.5 truncate">15-minute compare notes</div>
        </div>
      </div>
    </div>
  )
}

function ContentMock() {
  const queue: Array<{ time: string; channel: string; angle: string; tone: 'primary' | 'tertiary' }> = [
    { time: 'Tue 09:10', channel: 'LinkedIn', angle: 'Hidden cost of stalled pipelines', tone: 'primary' },
    { time: 'Tue 17:40', channel: 'X', angle: 'Why teams wait too long to switch', tone: 'tertiary' },
    { time: 'Wed 08:55', channel: 'LinkedIn', angle: 'Founder note: 3 reply patterns', tone: 'primary' },
  ]
  const bars = [42, 68, 35, 84, 56, 73, 49]
  return (
    <div>
      <MockChrome title="Content composer" badge="Brand voice 91" />
      <div className="bg-surface-container-lowest hairline-border rounded p-3 mb-stack-md">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-label-mono text-[9px] uppercase tracking-widest bg-primary-container/10 text-primary px-1.5 py-0.5 rounded">LinkedIn</span>
          <span className="font-label-mono text-[9px] uppercase tracking-widest text-on-surface-variant">draft 2 of 3</span>
        </div>
        <div className="font-body-main text-on-surface text-[13.5px] leading-relaxed">
          The pipelines that win this quarter aren&apos;t the loudest. They&apos;re the ones that learn the fastest — every reply tunes the next send.
        </div>
        <div className="mt-2 flex gap-1.5">
          <span className="font-label-mono text-[9px] uppercase tracking-widest bg-tertiary/10 text-tertiary px-1.5 py-0.5 rounded">on voice</span>
          <span className="font-label-mono text-[9px] uppercase tracking-widest bg-primary-container/10 text-primary px-1.5 py-0.5 rounded">hook strong</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-stack-md">
        <div className="bg-surface-container-lowest hairline-border rounded p-2.5">
          <div className="font-label-mono text-[9px] uppercase tracking-widest text-on-surface-variant mb-1">Queue</div>
          {queue.map(item => (
            <div key={item.time} className="flex items-center gap-2 py-1 border-b border-outline-variant/20 last:border-0">
              <span className="font-label-mono text-[9px] uppercase tracking-widest text-outline shrink-0">{item.time}</span>
              <span className={`font-label-mono text-[9px] uppercase tracking-widest px-1 rounded ${item.tone === 'tertiary' ? 'bg-tertiary/10 text-tertiary' : 'bg-primary-container/10 text-primary'}`}>{item.channel}</span>
              <span className="font-body-main text-[12px] text-on-surface truncate">{item.angle}</span>
            </div>
          ))}
        </div>
        <div className="bg-surface-container-lowest hairline-border rounded p-2.5">
          <div className="flex items-center justify-between mb-1">
            <div className="font-label-mono text-[9px] uppercase tracking-widest text-on-surface-variant">Engagement</div>
            <div className="font-label-mono text-[9px] uppercase tracking-widest text-primary">last 7</div>
          </div>
          <div className="flex items-end gap-1 h-[64px]">
            {bars.map((b, i) => (
              <span key={i} className={`flex-1 rounded-t ${i === 3 ? 'bg-primary' : 'bg-primary/30'}`} style={{ height: `${b}%` }} />
            ))}
          </div>
          <div className="font-body-main text-[12px] text-on-surface-variant mt-1">Wed peak · 1.6× baseline reply</div>
        </div>
      </div>
    </div>
  )
}

function CampaignMock() {
  return (
    <div>
      <MockChrome title="Campaign · Series-C operators" badge="42% reply" />
      <div className="grid grid-cols-4 gap-2 mb-stack-md">
        <StatTile label="Enrolled" value="38" />
        <StatTile label="Sent" value="24" tone="primary" />
        <StatTile label="Replied" value="11" tone="primary" />
        <StatTile label="Booked" value="4" tone="tertiary" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-surface-container-lowest hairline-border rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="font-label-mono text-[9px] uppercase tracking-widest text-on-surface-variant">Learning loop</div>
            <span className="font-label-mono text-[9px] uppercase tracking-widest bg-primary-container/10 text-primary px-1.5 py-0.5 rounded">42% reply</span>
          </div>
          <div className="font-body-main text-on-surface text-[13px] mb-2">Outcome data is shaping the next batch.</div>
          <div className="grid grid-cols-2 gap-1.5">
            <StatTile label="Signal" value="Funding" />
            <StatTile label="Persona" value="Revenue" />
            <StatTile label="Booked" value="17%" tone="tertiary" />
            <StatTile label="Content" value="3 attached" />
          </div>
        </div>
        <div className="bg-surface-container-lowest hairline-border rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="font-label-mono text-[9px] uppercase tracking-widest text-on-surface-variant">Content air cover</div>
            <span className="font-label-mono text-[9px] uppercase tracking-widest bg-tertiary/10 text-tertiary px-1.5 py-0.5 rounded">support</span>
          </div>
          <div className="space-y-1.5">
            {[
              { title: 'Why this funding moment matters', meta: 'LinkedIn · Revenue' },
              { title: 'The hidden cost of stalled pipelines', meta: 'Founder post · pain' },
              { title: 'Common objection: why teams wait', meta: 'Objection · reply support' },
            ].map(item => (
              <div key={item.title} className="bg-surface hairline-border rounded p-2">
                <div className="font-body-main text-[12.5px] text-on-surface truncate">{item.title}</div>
                <div className="font-label-mono text-[9px] uppercase tracking-widest text-on-surface-variant mt-0.5">{item.meta}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
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
    <section id="teams" className="relative max-w-[1280px] mx-auto px-margin-page py-24 md:py-32 border-t border-outline-variant/30">
      <span aria-hidden className="float-orb orb-tertiary drift-slower" style={{ width: 460, height: 460, top: 80, right: '-4%', zIndex: 0 }} />
      <div className="relative grid grid-cols-1 md:grid-cols-12 gap-gutter items-center" style={{ zIndex: 1 }}>
        <div className="md:col-span-4">
          <h2 className="font-h1-editorial text-[32px] md:text-[48px] leading-tight mb-stack-md">For teams</h2>
          <p className="font-body-large text-on-surface-variant mb-stack-lg">Total visibility into why a lead was contacted. Every outreach is backed by a verifiable chain of logic.</p>
          <ul className="space-y-stack-sm">
            {['No black-box AI', 'Verifiable source links', 'Human-in-the-loop ready'].map((t) => (
              <li key={t} className="font-label-mono text-label-mono flex gap-3 items-center uppercase">
                <span className="w-1.5 h-1.5 bg-primary" /> {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="md:col-start-6 md:col-span-7 layer-stack rounded-lg">
          <span aria-hidden className="layer-back rounded-lg" />
          <div className="layer-front grid-block panel-soft p-4 depth-stack">
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
      </div>
    </section>
  )
}

/* ─── 04 For Agents ───────────────────────────────────────────── */

const AGENT_TOOLS = ['signal', 'enrich', 'match', 'draft', 'send', 'write', 'publish', 'reply'] as const

function AgentDiagram() {
  return (
    <div className="layer-stack rounded-lg">
    <span aria-hidden className="layer-back rounded-lg" />
    <span aria-hidden className="layer-back-2 rounded-lg" />
    <div className="layer-front grid-block panel-soft p-stack-lg depth-stack">
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
    </div>
  )
}

function ForAgents() {
  return (
    <section id="agents" className="relative max-w-[1280px] mx-auto px-margin-page py-24 md:py-32">
      <span aria-hidden className="float-orb orb-primary drift-slow" style={{ width: 420, height: 420, top: 120, left: '-3%', zIndex: 0 }} />
      <div className="relative grid grid-cols-1 md:grid-cols-12 gap-gutter items-center" style={{ zIndex: 1 }}>
        <div className="md:col-span-6 order-2 md:order-1">
          <AgentDiagram />
        </div>
        <div className="md:col-start-9 md:col-span-4 order-1 md:order-2">
          <h2 className="font-h1-editorial text-[32px] md:text-[48px] leading-tight mb-stack-md">For agents</h2>
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
        <h2 className="font-h1-editorial text-[32px] md:text-[48px] leading-tight mb-stack-md">Works with your stack</h2>
        <p className="font-body-large text-on-surface-variant max-w-2xl mx-auto mb-stack-lg">Connect once — every agent uses what&rsquo;s here. No migrations.</p>
        <span className="font-label-mono text-label-mono text-on-surface-variant uppercase tracking-[0.2em]">Connected today</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-gutter">
        {INTEGRATIONS.map((it) => (
          <div key={it.name} className="bg-surface-container-lowest hairline-border p-6 flex flex-col items-center justify-center gap-3 hover:border-primary/50 depth-lift group cursor-default">
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
    <section className="relative overflow-hidden bg-surface-container-low border-t border-outline-variant/30">
      <span aria-hidden className="absolute pointer-events-none" style={{ width: 720, height: 720, top: -120, left: 'calc(50% - 360px)', zIndex: 0 }}>
        <span className="float-orb orb-primary drift-slower" style={{ inset: 0, width: '100%', height: '100%' }} />
      </span>
      <div className="relative max-w-[1120px] mx-auto px-margin-page py-[120px] md:py-[150px] text-center" style={{ zIndex: 1 }}>
        <p className="font-label-mono text-label-mono uppercase tracking-[0.25em] text-on-surface-variant mb-stack-md">Get started</p>

        <h2 className="font-h1-editorial font-semibold text-on-surface leading-[1.08] tracking-[-0.02em] text-balance">
          <span className="block sm:whitespace-nowrap text-[clamp(1.875rem,6vw,3.6rem)]">Run GTM on the move.</span>
          <span className="block text-[clamp(1.4rem,3.4vw,2.4rem)] text-primary italic">Get Bombsell.</span>
        </h2>

        <p className="font-body-large text-body-large text-on-surface-variant max-w-xl mx-auto mt-stack-lg leading-relaxed">
          A fleet of agents running outbound, content, and campaign motions - composable, on autopilot when you want it. Start free, no card.
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
        <FootCol title="Product" links={[['Workflows', '#workflows'], ['How it works', '#loop'], ['Pricing', '/pricing'], ['Integrations', '#integrations']]} />
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
