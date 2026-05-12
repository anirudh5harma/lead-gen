'use client'

import Link from 'next/link'
import { useState } from 'react'
import Icon from '@/components/Icon'

/* ─── data ─────────────────────────────────────────────────────── */

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'
type Endpoint = { method: Method; path: string; summary: string; auth?: 'AgentKey' | 'Session' }

const ENDPOINT_GROUPS: Record<string, { note: string; endpoints: Endpoint[] }> = {
  agents: {
    note: 'Discover system agents, inspect health, dispatch a single agent, manage external agent identities.',
    endpoints: [
      { method: 'GET', path: '/api/a2a/agents', summary: 'List system agents (17 roles) + health' },
      { method: 'GET', path: '/api/agents/{role}', summary: 'Inspect an agent: capabilities, tools, version, health' },
      { method: 'POST', path: '/api/agents/{role}/dispatch', summary: 'Dispatch one tool to one agent — { tool, arguments }', auth: 'AgentKey' },
      { method: 'GET', path: '/api/agents', summary: 'List your workspace’s external agent identities', auth: 'Session' },
      { method: 'POST', path: '/api/agents', summary: 'Register an external agent identity', auth: 'Session' },
    ],
  },
  pipelines: {
    note: 'Run a canonical engine — outbound (signal → enrich → draft → send → book) or content (idea → write → publish → learn). Disabled agents are skipped; acting steps honour each agent’s autonomy mode. Legacy presets (full-funnel, signal-to-insight, …) still work.',
    endpoints: [
      { method: 'GET', path: '/api/a2a/workflows', summary: 'List pipeline definitions (engine + steps)' },
      { method: 'POST', path: '/api/a2a/workflows', summary: "Run a pipeline — { workflow: 'outbound' | 'content' | …, context? }", auth: 'AgentKey' },
    ],
  },
  content: {
    note: 'Composable content agents — each is a tool dispatched against /api/agents/{role}/dispatch, or run them together via the "content" pipeline.',
    endpoints: [
      { method: 'POST', path: '/api/agents/idea/dispatch', summary: 'idea — generate scored angles · bombsell.idea.generate | .list', auth: 'AgentKey' },
      { method: 'POST', path: '/api/agents/writer/dispatch', summary: 'writer — draft a post / thread · bombsell.content.write | .thread', auth: 'AgentKey' },
      { method: 'POST', path: '/api/agents/editor/dispatch', summary: 'editor — brand-voice & format pass · bombsell.content.edit', auth: 'AgentKey' },
      { method: 'POST', path: '/api/agents/publisher/dispatch', summary: 'publisher — schedule / publish · bombsell.content.schedule | .publish', auth: 'AgentKey' },
      { method: 'POST', path: '/api/agents/engagement/dispatch', summary: 'engagement — pull metrics, attribute outcomes · bombsell.content.metrics', auth: 'AgentKey' },
      { method: 'POST', path: '/api/agents/repurpose/dispatch', summary: 'repurpose — top post → new idea · bombsell.content.repurpose', auth: 'AgentKey' },
    ],
  },
  keys: {
    note: 'Issue / revoke agent API keys (raw secret returned once) and manage per-agent credit wallets.',
    endpoints: [
      { method: 'GET', path: '/api/agents/keys', summary: 'List keys for an agent identity (?agent_id)', auth: 'Session' },
      { method: 'POST', path: '/api/agents/keys', summary: 'Create a key — returns the raw api_key once', auth: 'Session' },
      { method: 'DELETE', path: '/api/agents/keys', summary: 'Revoke a key', auth: 'Session' },
      { method: 'GET', path: '/api/agents/wallet', summary: 'Inspect an agent wallet (?agent_id)', auth: 'Session' },
      { method: 'POST', path: '/api/agents/wallet', summary: 'Top up an agent wallet', auth: 'Session' },
    ],
  },
  events: {
    note: 'The recent agent-event stream for your workspace — task starts, completions, errors, pipeline transitions.',
    endpoints: [
      { method: 'GET', path: '/api/agents/events', summary: 'Recent agent events (?limit, 1–100)', auth: 'Session' },
    ],
  },
  webhooks: {
    note: 'Receive task results (signature-verified) and manage subscriptions.',
    endpoints: [
      { method: 'GET', path: '/api/agents/webhook', summary: 'Webhook endpoint metadata' },
      { method: 'POST', path: '/api/agents/webhook', summary: 'Receive external agent task results', auth: 'AgentKey' },
      { method: 'GET', path: '/api/agents/webhooks', summary: 'List webhook subscriptions', auth: 'Session' },
      { method: 'POST', path: '/api/agents/webhooks', summary: 'Create a webhook subscription', auth: 'Session' },
      { method: 'DELETE', path: '/api/agents/webhooks', summary: 'Delete a webhook subscription', auth: 'Session' },
    ],
  },
}

const NAV: Array<{ group: string; items: Array<{ id: string; label: string }> }> = [
  { group: 'Start here', items: [
    { id: 'overview', label: 'Overview' },
    { id: 'quickstart', label: 'Quickstart' },
    { id: 'auth', label: 'Authentication' },
  ]},
  { group: 'Reference', items: [
    { id: 'agents', label: 'Agents' },
    { id: 'pipelines', label: 'Pipelines' },
    { id: 'content', label: 'Content engine' },
    { id: 'keys', label: 'Keys & wallet' },
    { id: 'events', label: 'Events' },
    { id: 'webhooks', label: 'Webhooks' },
  ]},
]
const ALL_ITEMS = NAV.flatMap(g => g.items)
const LABEL: Record<string, string> = Object.fromEntries(ALL_ITEMS.map(i => [i.id, i.label]))

const METHOD_TONE: Record<Method, string> = { GET: 'text-tertiary', POST: 'text-primary', PATCH: 'text-secondary', DELETE: 'text-error' }

/* ─── page ─────────────────────────────────────────────────────── */

export default function DocsClient() {
  const [active, setActive] = useState('overview')
  const go = (id: string) => { setActive(id); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }

  return (
    <div className="relative min-h-screen bg-surface text-on-surface font-body-main">
      <div aria-hidden className="hero-bg pointer-events-none absolute inset-x-0 top-0 h-[680px] -z-10" />
      <header className="sticky top-0 z-40 bg-surface/65 backdrop-blur-xl border-b border-outline-variant/15">
        <div className="flex items-center justify-between h-16 px-margin-page max-w-[1280px] mx-auto">
          <div className="flex items-center gap-stack-md">
            <Link href="/" className="font-semibold text-[19px] tracking-tight text-on-surface">Bombsell</Link>
          </div>
          <div className="flex items-center gap-stack-lg">
            <a href="/api/docs/agents" className="font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant hover:text-primary transition-colors inline-flex items-center gap-1.5"><Icon name="data_object" size={14} /> OpenAPI JSON</a>
          </div>
        </div>
      </header>

      {/* mobile: horizontal category chips */}
      <div className="lg:hidden border-b border-outline-variant/30">
        <div className="max-w-[1280px] mx-auto px-margin-page flex gap-2 overflow-x-auto py-stack-md">
          {ALL_ITEMS.map(i => (
            <button key={i.id} onClick={() => go(i.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] whitespace-nowrap transition-colors ${active === i.id ? 'bg-secondary-container text-on-secondary-container' : 'border border-outline-variant/40 text-on-surface-variant'}`}>
              {i.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-[1280px] mx-auto px-margin-page lg:flex lg:gap-stack-lg">
        {/* desktop sidebar */}
        <aside className="hidden lg:block w-56 shrink-0 py-section-gap">
          <nav className="sticky top-24 space-y-stack-md">
            {NAV.map(g => (
              <div key={g.group}>
                <p className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant mb-2">{g.group}</p>
                <ul className="space-y-0.5">
                  {g.items.map(i => (
                    <li key={i.id}>
                      <button onClick={() => go(i.id)}
                        className={`w-full text-left px-2 py-1.5 rounded text-[14px] transition-colors ${active === i.id ? 'bg-secondary-container text-on-secondary-container font-medium' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'}`}>
                        {i.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* content */}
        <main className="flex-1 min-w-0 py-section-gap">
          <p className="font-label-mono text-label-mono uppercase tracking-widest text-primary mb-2">Bombsell Agent API · v1</p>
          <h1 className="font-h1-editorial font-semibold text-[clamp(1.75rem,3vw,2.5rem)] leading-tight tracking-[-0.02em] text-on-surface mb-stack-md">{active === 'overview' ? 'API reference' : LABEL[active]}</h1>

          {active === 'overview' && <Overview onGo={go} />}
          {active === 'quickstart' && <Quickstart />}
          {active === 'auth' && <Auth />}
          {ENDPOINT_GROUPS[active] && <EndpointSection id={active} />}

        </main>
      </div>
    </div>
  )
}

/* ─── sections ─────────────────────────────────────────────────── */

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="hairline-border bg-surface-container-lowest p-stack-md">
      <p className="font-label-mono text-label-mono uppercase tracking-widest text-primary mb-2">{title}</p>
      <div className="font-body-main text-[13.5px] text-on-surface-variant leading-relaxed">{children}</div>
    </div>
  )
}

function Pre({ children }: { children: string }) {
  return <pre className="mt-stack-md bg-[#1A1816] text-[#e8d9d3] p-stack-md overflow-x-auto text-[13px] leading-relaxed rounded">{children}</pre>
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="px-stack-md py-3 flex flex-wrap items-baseline gap-x-3">
      <span className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant w-16 shrink-0">{k}</span>
      <span className="text-[13.5px]">{v}</span>
    </div>
  )
}

function Overview({ onGo }: { onGo: (id: string) => void }) {
  return (
    <>
      <p className="font-body-large text-body-large text-on-surface-variant leading-relaxed max-w-2xl">
        GTM as tools your agent can call — discover agents, dispatch tasks, run pipelines, receive webhooks, manage keys. Plain HTTP/JSON. Speaks A2A, REST, and MCP.
      </p>
      <div className="mt-stack-lg grid sm:grid-cols-2 gap-stack-md">
        <Card title="For builders & agents">
          Call individual agents or whole pipelines from any runtime. Start with the{' '}
          <button onClick={() => onGo('quickstart')} className="text-primary hover:underline">quickstart</button>, then browse the{' '}
          <button onClick={() => onGo('agents')} className="text-primary hover:underline">reference</button>. Full schemas in the{' '}
          <a href="/api/docs/agents" className="text-primary hover:underline">OpenAPI spec</a>.
        </Card>
        <Card title="For humans">
          Issue an agent key from <Link href="/dashboard?view=integrations" className="text-primary hover:underline">Dashboard → Integrations → Agents API</Link>, subscribe a webhook for outcomes, and watch runs in the Agents view. No code needed to run the engines from the app.
        </Card>
      </div>
      <div className="mt-stack-md hairline-border bg-surface-container-lowest divide-y divide-outline-variant/20">
        <KV k="Base URL" v={<code className="font-label-mono text-on-surface">https://bombsell.com</code>} />
        <KV k="Auth" v={<><code className="font-label-mono text-on-surface">Authorization: Bearer &lt;key&gt;</code> <span className="text-[13px] text-on-surface-variant">— see <button onClick={() => onGo('auth')} className="text-primary hover:underline">Authentication</button></span></>} />
        <KV k="Spec" v={<a href="/api/docs/agents" className="text-primary hover:underline font-label-mono">OpenAPI 3.0.3 JSON</a>} />
      </div>
    </>
  )
}

function Quickstart() {
  const steps: Array<[string, React.ReactNode]> = [
    ['Get a key', <>Sign in, then <Link href="/dashboard?view=integrations" className="text-primary hover:underline">Dashboard → Integrations → Agents API</Link> → <em>Issue agent key</em>. The raw key is shown once.</>],
    ['Call it', <>Dispatch one agent (<code className="font-label-mono">POST /api/agents/&#123;role&#125;/dispatch</code>) or a whole pipeline (<code className="font-label-mono">POST /api/a2a/workflows</code>).</>],
    ['Stream outcomes', <>Subscribe a webhook (<code className="font-label-mono">POST /api/agents/webhooks</code>) to get task results, replies, and bookings pushed back.</>],
  ]
  return (
    <>
      <p className="font-body-large text-body-large text-on-surface-variant leading-relaxed">Three steps to your first run.</p>
      <ol className="mt-stack-md space-y-stack-md">
        {steps.map(([t, d], i) => (
          <li key={i} className="grid grid-cols-[28px_1fr] gap-3">
            <span className="font-label-mono text-[12px] text-primary">{String(i + 1).padStart(2, '0')}</span>
            <div className="font-body-main text-[14px] text-on-surface-variant leading-relaxed"><span className="text-on-surface font-medium">{t}</span> — {d}</div>
          </li>
        ))}
      </ol>
      <p className="mt-stack-lg font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant">Run a pipeline</p>
      <Pre>{`curl https://bombsell.com/api/a2a/workflows -X POST \\
  -H "Authorization: Bearer ak_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "workflow": "outbound", "context": { "companyDomain": "acme.com" } }'`}</Pre>
      <p className="mt-stack-lg font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant">Or one agent</p>
      <Pre>{`curl https://bombsell.com/api/agents/writer/dispatch -X POST \\
  -H "Authorization: Bearer ak_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "tool": "bombsell.content.write", "arguments": { "ideaId": "..." } }'`}</Pre>
      <p className="mt-stack-md font-body-main text-[13.5px] text-on-surface-variant">SDK: <code className="font-label-mono">pnpm add @bombsell/sdk</code> — typed wrappers over every agent + pipeline, plus a webhook event emitter.</p>
    </>
  )
}

function Auth() {
  return (
    <>
      <p className="font-body-main text-body-main text-on-surface-variant leading-relaxed">Two schemes, both bearer tokens in the <code className="font-label-mono text-on-surface">Authorization</code> header.</p>
      <div className="mt-stack-md space-y-px bg-outline-variant/30 hairline-border">
        <div className="bg-surface-container-lowest p-stack-md">
          <p className="font-label-mono text-label-mono uppercase tracking-widest text-primary mb-1">AgentKey</p>
          <p className="font-body-main text-[13.5px] text-on-surface-variant leading-relaxed">The one-time key from <code className="font-label-mono text-on-surface">POST /api/agents/keys</code> (issued under an external agent identity). For agent-to-agent calls — dispatch, pipelines, inbound webhooks. Scoped to the workspace that owns the identity.</p>
        </div>
        <div className="bg-surface-container-lowest p-stack-md">
          <p className="font-label-mono text-label-mono uppercase tracking-widest text-secondary mb-1">Session</p>
          <p className="font-body-main text-[13.5px] text-on-surface-variant leading-relaxed">The signed-in workspace session (the dashboard cookie). For workspace-management endpoints — agent identities, keys, wallets, events, webhook subscriptions.</p>
        </div>
      </div>
      <Pre>{`# header on every request
Authorization: Bearer ak_live_8f3c...   # AgentKey`}</Pre>
    </>
  )
}

function EndpointSection({ id }: { id: string }) {
  const g = ENDPOINT_GROUPS[id]
  return (
    <>
      <p className="font-body-main text-[14px] text-on-surface-variant leading-relaxed mb-stack-lg">{g.note}</p>
      <div className="hairline-border bg-surface-container-lowest divide-y divide-outline-variant/15">
        {g.endpoints.map(ep => (
          <div key={ep.method + ep.path} className="px-stack-md py-3.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={`font-label-mono text-[10px] uppercase tracking-widest w-12 shrink-0 ${METHOD_TONE[ep.method]}`}>{ep.method}</span>
            <code className="font-label-mono text-[13px] text-on-surface break-all">{ep.path}</code>
            {ep.auth && <span className="font-label-mono text-[9px] uppercase tracking-widest text-on-surface-variant inline-flex items-center gap-1"><Icon name="lock" size={11} />{ep.auth}</span>}
            <span className="basis-full text-[13px] text-on-surface-variant pl-12">{ep.summary}</span>
          </div>
        ))}
      </div>
      <p className="mt-stack-md font-body-main text-[13px] text-on-surface-variant">Request / response schemas for every endpoint: <a href="/api/docs/agents" className="text-primary hover:underline">OpenAPI spec</a>.</p>
    </>
  )
}
