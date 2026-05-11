'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * /agents — public landing for AI agents and builders.
 * Editorial system, four numbered sections:
 *   01 Hero        → Bombsell speaks A2A
 *   02 Quickstart  → SDK + REST tabs
 *   03 The 11      → table of agents and their tools
 *   04 Workflows   → 4 chains as one POST
 */
export default function AgentsLandingPage() {
  const [signedIn, setSignedIn] = useState(false)
  useEffect(() => {
    void createClient().auth.getSession().then(({ data }) => setSignedIn(!!data.session))
  }, [])
  // Signed-in devs land directly on the Agents API section of Integrations.
  const apiKeyHref = signedIn ? '/dashboard?view=integrations' : '/'

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-ink-1)]">
      <Nav apiKeyHref={apiKeyHref} />
      <main className="flex-1">
        <Hero />
        <Quickstart />
        <Roster />
        <Workflows />
        <Cta apiKeyHref={apiKeyHref} />
      </main>
      <Footer />
    </div>
  )
}

/* ─── Nav ─────────────────────────────────────────────────────── */

function Nav({ apiKeyHref }: { apiKeyHref: string }) {
  return (
    <nav className="sticky top-0 z-30 border-b border-[var(--color-line-1)] bg-[var(--color-ink-1)]/85 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto h-14 px-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo.svg" alt="Bombsell" width={22} height={22} />
          <span className="text-[14px] font-semibold tracking-tight">Bombsell</span>
        </Link>
        <div className="flex items-center gap-7">
          <Link href="/#loop" className="hidden md:block text-[13px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)]">The Loop</Link>
          <span className="hidden md:block text-[13px] font-medium">For agents</span>
          <Link href="/pricing" className="hidden md:block text-[13px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)]">Pricing</Link>
          <Link href="/api/docs/agents" className="hidden md:block text-[13px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)]">Docs</Link>
          <Link href={apiKeyHref} className="btn-primary h-8 px-4 text-[13px] inline-flex items-center">Get an API key →</Link>
        </div>
      </div>
    </nav>
  )
}

/* ─── 01 Hero ─────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="max-w-6xl mx-auto px-6 pt-24 md:pt-32 pb-20">
      <div className="flex items-center gap-3 mb-10">
        <span className="section-num">01</span>
        <span className="h-px w-12 bg-[var(--color-line-2)]" />
        <span className="mono">For AI agents &amp; builders</span>
      </div>
      <h1 className="editorial-h1 max-w-4xl">
        GTM as <span className="serif-italic text-[var(--color-accent)]">tools</span> your agent can call.
      </h1>
      <p className="text-[18px] text-[var(--color-text-2)] mt-8 max-w-2xl leading-relaxed">
        Bombsell exposes its 11-agent revenue loop as a typed A2A API. Discover capabilities, dispatch tasks, run multi-step workflows, subscribe to outcomes — from any agent runtime.
      </p>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Link href="/api/docs/agents" className="btn-accent h-10 px-5 text-[13px] inline-flex items-center">Read the API spec →</Link>
        <a href="#quickstart" className="btn-ghost h-10 px-5 text-[13px] inline-flex items-center">Quickstart</a>
      </div>

      <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--color-line-1)] border border-[var(--color-line-1)] rounded-xl overflow-hidden">
        <Stat k="Agents" v="11" />
        <Stat k="Tools" v="22" />
        <Stat k="Workflows" v="4" />
        <Stat k="Auth" v="A2A · MCP" />
      </div>
    </section>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-[var(--color-ink-1)] px-5 py-5">
      <div className="mono">{k}</div>
      <div className="text-[26px] font-medium tracking-tight mt-1">{v}</div>
    </div>
  )
}

/* ─── 02 Quickstart ───────────────────────────────────────────── */

function Quickstart() {
  const [tab, setTab] = useState<'sdk' | 'curl' | 'mcp'>('sdk')
  return (
    <section id="quickstart" className="border-t border-[var(--color-line-1)] bg-[var(--color-ink-2)]">
      <div className="max-w-6xl mx-auto px-6 py-24 md:py-28 grid md:grid-cols-12 gap-12">
        <div className="md:col-span-5">
          <div className="flex items-center gap-3 mb-6">
            <span className="section-num">02</span>
            <span className="h-px w-10 bg-[var(--color-line-2)]" />
            <span className="mono">Quickstart</span>
          </div>
          <h2 className="editorial-h2">
            Three lines to <span className="serif-italic text-[var(--color-accent)]">live</span>.
          </h2>
          <ul className="mt-8 space-y-4 text-[14px] text-[var(--color-text-2)]">
            <li className="grid grid-cols-[auto_1fr] gap-3"><span className="mono">01</span><span>Issue an agent key under Integrations &rarr; Agents API.</span></li>
            <li className="grid grid-cols-[auto_1fr] gap-3"><span className="mono">02</span><span>Install the SDK, or call the REST endpoints directly.</span></li>
            <li className="grid grid-cols-[auto_1fr] gap-3"><span className="mono">03</span><span>Subscribe a webhook URL to stream task outcomes back.</span></li>
          </ul>

          <div className="mt-8 flex items-center gap-1 border border-[var(--color-line-2)] rounded-full p-1 w-fit bg-[var(--color-ink-1)]">
            {([['sdk', 'SDK'], ['curl', 'cURL'], ['mcp', 'MCP']] as const).map(([id, label]) => (
              <button
                key={id} onClick={() => setTab(id)}
                className={`h-8 px-4 rounded-full text-[12px] transition-colors ${
                  tab === id ? 'bg-[var(--color-text-1)] text-[var(--color-ink-0)]' : 'text-[var(--color-text-2)]'
                }`}
              >{label}</button>
            ))}
          </div>
        </div>

        <div className="md:col-span-7">
          {tab === 'sdk' && <SdkSample />}
          {tab === 'curl' && <CurlSample />}
          {tab === 'mcp' && <McpSample />}
        </div>
      </div>
    </section>
  )
}

function SdkSample() {
  return (
    <div className="codeblock">
      <span className="c-com">{`// pnpm add @bombsell/sdk`}</span>{`
import { Bombsell } from '@bombsell/sdk'

const bombsell = new Bombsell({ apiKey: process.env.BOMBSELL_KEY })

`}<span className="c-com">{`// Run the loop end-to-end`}</span>{`
const run = await bombsell.workflows.run('full-funnel', {
  icp: 'Series A → C dev tools, 50–500 employees',
  signals: ['funding', 'hiring', 'launch'],
})

`}<span className="c-com">{`// Or call individual agents`}</span>{`
const enriched = await bombsell.enrich.contacts({
  targetCompany: 'Acme',
  roles: ['VP Sales', 'Head of GTM'],
})

`}<span className="c-com">{`// Stream outcomes`}</span>{`
bombsell.events.on('reply.classified', (e) => {
  if (e.intent === 'meeting_requested') schedule(e.lead)
})`}
    </div>
  )
}

function CurlSample() {
  return (
    <div className="codeblock">
      <span className="c-com">{`# List agents`}</span>{`
curl https://bombsell.com/api/a2a/agents \\
  -H "Authorization: Bearer $BOMBSELL_KEY"

`}<span className="c-com">{`# Dispatch one tool`}</span>{`
curl -X POST https://bombsell.com/api/agents/match/dispatch \\
  -H "Authorization: Bearer $BOMBSELL_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"tool":"bombsell.match.rank","arguments":{"limit":50}}'

`}<span className="c-com">{`# Run a workflow`}</span>{`
curl -X POST https://bombsell.com/api/a2a/workflows \\
  -H "Authorization: Bearer $BOMBSELL_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"workflow":"full-funnel"}'`}
    </div>
  )
}

function McpSample() {
  return (
    <div className="codeblock">
      <span className="c-com">{`# Add Bombsell as an MCP server in Claude / Cursor / Codex`}</span>{`
{
  "mcpServers": {
    "bombsell": {
      "url": "https://bombsell.com/api/mcp",
      "headers": { "Authorization": "Bearer $BOMBSELL_KEY" }
    }
  }
}

`}<span className="c-com">{`# All 22 tools auto-discover with schemas and costs`}</span>{`
`}<span className="c-key">→</span>{` bombsell.signal.poll
`}<span className="c-key">→</span>{` bombsell.match.rank
`}<span className="c-key">→</span>{` bombsell.enrich.contacts
`}<span className="c-key">→</span>{` bombsell.outreach.draft
`}<span className="c-key">→</span>{` bombsell.outreach.send
`}<span className="c-com">{`  # … 17 more`}</span>
    </div>
  )
}

/* ─── 03 The 11 ───────────────────────────────────────────────── */

const ROSTER: Array<[string, string, string]> = [
  // outbound engine
  ['signal',     'Listen',   'poll, ingest'],
  ['match',      'Match',    'candidates, rank'],
  ['enrich',     'Enrich',   'contacts, verify'],
  ['safety',     'Guard',    'check, simulate'],
  ['outreach',   'Send',     'draft, send, eval_draft'],
  ['reply',      'Read',     'classify'],
  ['booking',    'Book',     'send_link, status'],
  ['followup',   'Followup', 'schedule'],
  // content engine
  ['idea',       'Ideate',   'generate, list'],
  ['writer',     'Write',    'write, thread'],
  ['editor',     'Edit',     'edit'],
  ['publisher',  'Publish',  'schedule, publish'],
  ['engagement', 'Measure',  'metrics'],
  ['repurpose',  'Repurpose','repurpose'],
  // shared / add-ons / control
  ['insight',    'Insight',  'list, generate'],
  ['crm',        'Sync',     'sync, export'],
  ['operator',   'Operator', 'orchestrate, status'],
]

function Roster() {
  return (
    <section className="border-t border-[var(--color-line-1)]">
      <div className="max-w-6xl mx-auto px-6 py-24 md:py-28">
        <div className="flex items-center gap-3 mb-10">
          <span className="section-num">03</span>
          <span className="h-px w-12 bg-[var(--color-line-2)]" />
          <span className="mono">The roster · 17 agents</span>
        </div>
        <h2 className="editorial-h2 max-w-2xl">
          Each agent is <span className="serif-italic text-[var(--color-accent)]">independently</span> callable.
        </h2>

        <div className="mt-12 card overflow-hidden">
          <div className="grid grid-cols-[120px_1fr_2fr_auto] px-5 py-3 mono border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]">
            <span>role</span><span>function</span><span>tools</span><span>endpoint</span>
          </div>
          {ROSTER.map(([role, fn, tools]) => (
            <div key={role} className="grid grid-cols-[120px_1fr_2fr_auto] px-5 py-3.5 items-center border-b border-[var(--color-line-1)] last:border-0 hover:bg-[var(--color-ink-2)] transition-colors gap-4">
              <span className="text-[13.5px] font-medium">{role}</span>
              <span className="text-[13px] text-[var(--color-text-2)]">{fn}</span>
              <span className="mono">{tools}</span>
              <code className="text-[11.5px] font-mono text-[var(--color-text-3)]">/api/agents/{role}</code>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── 04 Workflows ────────────────────────────────────────────── */

const WORKFLOWS: Array<[string, string, string]> = [
  ['outbound',              'Listen → match → enrich → guard → draft → send → read → book/followup', 'The Outbound engine — full pipeline'],
  ['content',               'Ideate → write → edit → schedule → publish → measure → repurpose',      'The Content engine — LinkedIn / X'],
  ['full-funnel',           'Listen → match → enrich → guard → send',  'Legacy preset'],
  ['signal-to-insight',     'Listen → match → insight',                'Legacy preset — prioritisation only'],
  ['enrich-and-outreach',   'Enrich → guard → send',                   'Legacy preset'],
  ['reply-handling',        'Read → book or followup',                 'Legacy preset — inbound triage'],
]

function Workflows() {
  return (
    <section className="border-t border-[var(--color-line-1)] bg-[var(--color-ink-2)]">
      <div className="max-w-6xl mx-auto px-6 py-24 md:py-28">
        <div className="flex items-center gap-3 mb-10">
          <span className="section-num">04</span>
          <span className="h-px w-12 bg-[var(--color-line-2)]" />
          <span className="mono">Workflows · one POST each</span>
        </div>
        <h2 className="editorial-h2 max-w-2xl">
          Compose, or hand the loop to the <span className="serif-italic text-[var(--color-accent)]">operator</span>.
        </h2>

        <div className="mt-12 grid md:grid-cols-2 gap-4">
          {WORKFLOWS.map(([name, chain, desc]) => (
            <div key={name} className="card p-5">
              <div className="flex items-baseline justify-between gap-2">
                <code className="text-[13px] font-mono font-semibold">{name}</code>
                <Link href="/api/docs/agents" className="text-[12px] text-[var(--color-accent)] hover:underline">spec →</Link>
              </div>
              <div className="mono mt-2">{chain}</div>
              <p className="text-[13px] text-[var(--color-text-3)] mt-3">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── 05 CTA ──────────────────────────────────────────────────── */

function Cta({ apiKeyHref }: { apiKeyHref: string }) {
  return (
    <section className="border-t border-[var(--color-line-1)]">
      <div className="max-w-6xl mx-auto px-6 py-28 text-center">
        <h2 className="editorial-h1 max-w-3xl mx-auto">
          Build your agent. <span className="serif-italic text-[var(--color-accent)]">We&rsquo;ll bring the pipeline.</span>
        </h2>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Link href={apiKeyHref} className="btn-accent h-11 px-6 text-[14px] inline-flex items-center">Get an API key →</Link>
          <Link href="/api/docs/agents" className="btn-ghost h-11 px-6 text-[14px] inline-flex items-center">Read the spec</Link>
        </div>
        <p className="mono mt-6">Auth: bearer key &middot; A2A protocol &middot; MCP-compatible</p>
      </div>
    </section>
  )
}

/* ─── Footer ──────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="border-t border-[var(--color-line-1)] py-10">
      <div className="max-w-6xl mx-auto px-6 flex flex-wrap gap-x-6 gap-y-2 items-center justify-between text-[12px] text-[var(--color-text-4)]">
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
