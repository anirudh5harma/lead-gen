'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'

export default function AgentsGuidePage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'claude' | 'codex' | 'crewai' | 'api'>('overview')

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden" style={{ background: 'var(--color-ink-1)' }}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[900px] opacity-50"
        style={{ background: 'radial-gradient(ellipse 70% 55% at 50% -5%, var(--color-ink-3), transparent)' }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 dot-grid opacity-25" />

      {/* Navbar */}
      <nav className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <Image src="/logo.svg" alt="Bombsell" width={28} height={28} className="shrink-0 transition-transform duration-300 group-hover:scale-110" />
          <span className="text-[15px] font-semibold tracking-tight text-[var(--color-text-1)]">Bombsell</span>
        </Link>
        <div className="flex items-center gap-6">
          <Link href="/#platform" className="hidden md:block text-[13px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] transition-colors relative after:absolute after:bottom-0 after:left-0 after:w-0 after:h-[1px] after:bg-[var(--color-accent)] hover:after:w-full after:transition-all after:duration-300">Platform</Link>
          <Link href="/#differentiators" className="hidden md:block text-[13px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] transition-colors relative after:absolute after:bottom-0 after:left-0 after:w-0 after:h-[1px] after:bg-[var(--color-accent)] hover:after:w-full after:transition-all after:duration-300">Differentiation</Link>
          <Link href="/pricing" className="hidden md:block text-[13px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] transition-colors relative after:absolute after:bottom-0 after:left-0 after:w-0 after:h-[1px] after:bg-[var(--color-accent)] hover:after:w-full after:transition-all after:duration-300">Pricing</Link>
          <Link href="/agents" className="hidden md:block text-[13px] font-medium text-[var(--color-text-1)]">Agents</Link>
          <Link href="/dashboard" className="h-9 px-4 rounded-full btn-primary text-[13px] font-medium inline-flex items-center gap-1.5 cursor-pointer hover:scale-105 active:scale-95 transition-transform">
            Dashboard <span aria-hidden>→</span>
          </Link>
        </div>
      </nav>

      <main className="relative z-10 flex-1">
        {/* Hero */}
        <section className="w-full max-w-4xl mx-auto px-6 md:px-8 pt-12 md:pt-20 pb-10 text-center">
          <p className="text-[13px] md:text-[14px] font-medium tracking-[0.12em] uppercase text-[var(--color-text-3)] mb-4">
            Agent-to-Agent Infrastructure
          </p>
          <h1 className="text-[36px] md:text-[52px] lg:text-[64px] leading-[0.95] tracking-[-0.04em] text-[var(--color-text-1)] font-semibold">
            Bombsell for Agents
          </h1>
          <p className="mt-4 max-w-2xl mx-auto text-[17px] md:text-[19px] leading-[1.6] text-[var(--color-text-2)]">
            Give your AI agents real-time market signals, verified contacts, and safe outreach execution. 
            The same GTM infrastructure your team uses.
          </p>
        </section>

        {/* Tabs */}
        <section className="w-full max-w-4xl mx-auto px-6 md:px-8 mb-10">
          <div className="flex flex-wrap items-center justify-center gap-2">
            {[
              { id: 'overview' as const, label: 'Overview' },
              { id: 'claude' as const, label: 'Claude Code' },
              { id: 'codex' as const, label: 'Codex' },
              { id: 'crewai' as const, label: 'CrewAI / LangGraph' },
              { id: 'api' as const, label: 'REST API' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`h-9 px-4 rounded-full text-[13px] font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-[var(--color-accent)] text-white shadow-sm'
                    : 'bg-white border border-[var(--color-line-1)] text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:border-[var(--color-accent)]/30'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </section>

        {/* Content */}
        <section className="w-full max-w-3xl mx-auto px-6 md:px-8 pb-24">
          {activeTab === 'overview' && <OverviewSection />}
          {activeTab === 'claude' && <ClaudeSection />}
          {activeTab === 'codex' && <CodexSection />}
          {activeTab === 'crewai' && <CrewaiSection />}
          {activeTab === 'api' && <ApiSection />}
        </section>

        {/* Cost Reference */}
        <section className="w-full max-w-3xl mx-auto px-6 md:px-8 pb-24">
          <div className="card p-6 md:p-8">
            <h2 className="text-xl font-semibold text-[var(--color-text-1)] mb-6">Agent Action Pricing</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--color-line-1)]">
                    <th className="text-left py-2 font-medium text-[var(--color-text-3)]">Action</th>
                    <th className="text-right py-2 font-medium text-[var(--color-text-3)]">Credits</th>
                    <th className="text-left py-2 pl-4 font-medium text-[var(--color-text-3)]">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Signal delivered', '0.05', 'per signal'],
                    ['Account reasoned', '0.25', 'per call'],
                    ['Contact enriched', '0.50', 'per contact'],
                    ['Outreach executed', '1.00', 'per send'],
                    ['Avatar video rendered', '5.00', 'per render'],
                    ['Explore searched', '0.10', 'per call'],
                  ].map(([action, cost, unit]) => (
                    <tr key={action} className="border-b border-[var(--color-line-1)]">
                      <td className="py-2.5 text-[var(--color-text-1)]">{action}</td>
                      <td className="py-2.5 text-right font-mono text-[var(--color-accent-ring)]">{cost}</td>
                      <td className="py-2.5 pl-4 text-[var(--color-text-3)]">{unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-[12px] text-[var(--color-text-3)]">
              Agents have separate credit wallets funded from your human account. 
              Auto-top-up available in Settings. Unused credits roll over.
            </p>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-[var(--color-line-1)]">
        <div className="w-full max-w-7xl mx-auto px-6 md:px-8 py-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.svg" alt="Bombsell" width={24} height={24} className="shrink-0" />
            <span className="text-[12px] text-[var(--color-text-3)]">© {new Date().getFullYear()} Bombsell</span>
          </div>
          <div className="flex items-center gap-6 text-[12.5px] text-[var(--color-text-3)]">
            <Link href="/pricing" className="hover:text-[var(--color-text-1)] transition-colors">Pricing</Link>
            <Link href="/agents" className="hover:text-[var(--color-text-1)] transition-colors">Agents</Link>
            <Link href="/privacy" className="hover:text-[var(--color-text-1)] transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-[var(--color-text-1)] transition-colors">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

function OverviewSection() {
  return (
    <div className="space-y-8">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-[var(--color-text-1)] mb-3">What is Bombsell A2A?</h3>
        <p className="text-[14px] leading-[1.65] text-[var(--color-text-2)]">
          Bombsell A2A (Agent-to-Agent) exposes the same GTM infrastructure your team uses; 
          market signals, account reasoning, verified contacts, and safe outreach, as 
          agent-consumable APIs and MCP tools.
        </p>
        <p className="mt-3 text-[14px] leading-[1.65] text-[var(--color-text-2)]">
          Your agents get deterministic, structured outputs with cost estimates, guardrail 
          attestations, and audit hashes. Every action is logged, every credit is tracked.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { title: 'Register', body: 'Create an agent identity in Settings → Agent Infrastructure. Each agent gets a wallet.' },
          { title: 'Issue Keys', body: 'Generate scoped API keys with read/write permissions. Keys start with bsk_agt_.' },
          { title: 'Connect', body: 'Use the MCP server or REST API. Pay per action with agent credits.' },
        ].map(step => (
          <div key={step.title} className="card p-5">
            <h4 className="text-[14px] font-semibold text-[var(--color-text-1)] mb-2">{step.title}</h4>
            <p className="text-[13px] leading-[1.6] text-[var(--color-text-2)]">{step.body}</p>
          </div>
        ))}
      </div>

      <div className="card p-6">
        <h3 className="text-lg font-semibold text-[var(--color-text-1)] mb-3">Three Core Primitives</h3>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 h-2 w-2 rounded-full bg-[var(--color-pillar-timing)] shrink-0" />
            <div>
              <p className="text-[13px] font-semibold text-[var(--color-text-1)]">Watch Market</p>
              <p className="text-[12px] text-[var(--color-text-3)]">Subscribe to real-time signals. Webhooks push matches to your agent.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 h-2 w-2 rounded-full bg-[var(--color-pillar-quality)] shrink-0" />
            <div>
              <p className="text-[13px] font-semibold text-[var(--color-text-1)]">Reason Account</p>
              <p className="text-[12px] text-[var(--color-text-3)]">Get timing, quality, and accuracy scores. Know why now and what to say.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 h-2 w-2 rounded-full bg-[var(--color-pillar-accuracy)] shrink-0" />
            <div>
              <p className="text-[13px] font-semibold text-[var(--color-text-1)]">Execute Outreach</p>
              <p className="text-[12px] text-[var(--color-text-3)]">Send with guardrails. Verifiable attestations prove safety.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ClaudeSection() {
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-[var(--color-text-1)] mb-3">Claude Code (HTTP SSE)</h3>
        <p className="text-[14px] leading-[1.65] text-[var(--color-text-2)] mb-4">
          Claude Code connects directly to Bombsell&apos;s MCP server over HTTP. No proxy needed.
        </p>
        <ol className="space-y-3 text-[13px] text-[var(--color-text-2)] list-decimal list-inside">
          <li>Sign in to Bombsell with Google</li>
          <li>Copy your Supabase session token from the browser console (Network → any API call → Authorization header)</li>
          <li>Add Bombsell to your Claude Code configuration</li>
        </ol>
      </div>

      <div className="card p-6 bg-[var(--color-ink-2)]/30">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)] mb-2">claude_desktop_config.json</p>
        <pre className="text-[12px] font-mono text-[var(--color-text-1)] overflow-x-auto">
{`{
  "mcpServers": {
    "bombsell": {
      "url": "https://bombsell.com/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_SUPABASE_SESSION_TOKEN"
      }
    }
  }
}`}
        </pre>
      </div>

      <div className="card p-6">
        <h4 className="text-[14px] font-semibold text-[var(--color-text-1)] mb-2">Available Tools</h4>
        <ul className="space-y-1.5 text-[13px] text-[var(--color-text-2)]">
          <li><code className="text-[12px] font-mono bg-[var(--color-ink-2)] px-1.5 py-0.5 rounded">get_gtm_context</code> — Workspace profile and ICP</li>
          <li><code className="text-[12px] font-mono bg-[var(--color-ink-2)] px-1.5 py-0.5 rounded">list_leads</code> — Recent signals and leads</li>
          <li><code className="text-[12px] font-mono bg-[var(--color-ink-2)] px-1.5 py-0.5 rounded">bombsell_watch_market</code> — A2A signal subscription</li>
          <li><code className="text-[12px] font-mono bg-[var(--color-ink-2)] px-1.5 py-0.5 rounded">bombsell_reason_account</code> — Account intelligence</li>
          <li><code className="text-[12px] font-mono bg-[var(--color-ink-2)] px-1.5 py-0.5 rounded">bombsell_execute_outreach</code> — Safe sending</li>
        </ul>
      </div>
    </div>
  )
}

function CodexSection() {
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-[var(--color-text-1)] mb-3">OpenAI Codex (Stdio)</h3>
        <p className="text-[14px] leading-[1.65] text-[var(--color-text-2)] mb-4">
          Codex uses stdio to talk to MCP servers. Use the proxy script to bridge stdio to Bombsell&apos;s HTTP endpoint.
        </p>
      </div>

      <div className="card p-6 bg-[var(--color-ink-2)]/30">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)] mb-2">.codex/config.json</p>
        <pre className="text-[12px] font-mono text-[var(--color-text-1)] overflow-x-auto">
{`{
  "mcpServers": {
    "bombsell": {
      "command": "node",
      "args": ["/path/to/bombsell/scripts/mcp-stdio-proxy.mjs"],
      "env": {
        "BOMBSELL_MCP_URL": "https://bombsell.com/api/mcp",
        "BOMBSELL_MCP_TOKEN": "YOUR_SUPABASE_SESSION_TOKEN"
      }
    }
  }
}`}
        </pre>
      </div>

      <div className="card p-6">
        <h4 className="text-[14px] font-semibold text-[var(--color-text-1)] mb-2">Or with an Agent API Key</h4>
        <pre className="text-[12px] font-mono text-[var(--color-text-1)] overflow-x-auto bg-[var(--color-ink-2)]/30 p-4 rounded-xl">
{`{
  "mcpServers": {
    "bombsell": {
      "command": "node",
      "args": ["/path/to/bombsell/scripts/mcp-stdio-proxy.mjs"],
      "env": {
        "BOMBSELL_MCP_URL": "https://bombsell.com/api/mcp",
        "BOMBSELL_AGENT_API_KEY": "bsk_agt_xxxxxxxx"
      }
    }
  }
}`}
        </pre>
      </div>
    </div>
  )
}

function CrewaiSection() {
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-[var(--color-text-1)] mb-3">CrewAI / LangGraph / n8n</h3>
        <p className="text-[14px] leading-[1.65] text-[var(--color-text-2)] mb-4">
          For agent frameworks, use the REST API directly with your agent&apos;s API key.
        </p>
      </div>

      <div className="card p-6 bg-[var(--color-ink-2)]/30">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)] mb-2">Python (CrewAI)</p>
        <pre className="text-[12px] font-mono text-[var(--color-text-1)] overflow-x-auto">
{`import requests

BOMBSELL_API_KEY = "bsk_agt_xxxxxxxx"
HEADERS = {"Authorization": f"Bearer {BOMBSELL_API_KEY}"}

def reason_account(domain: str):
    res = requests.post(
        "https://bombsell.com/api/v1/accounts/reason",
        headers=HEADERS,
        json={"company_domain": domain},
    )
    return res.json()

# Use in your CrewAI agent
tools = [{
    "name": "reason_account",
    "func": reason_account,
    "description": "Analyze a company and return timing/quality/accuracy scores"
}]`}
        </pre>
      </div>

      <div className="card p-6 bg-[var(--color-ink-2)]/30">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)] mb-2">JavaScript (LangGraph)</p>
        <pre className="text-[12px] font-mono text-[var(--color-text-1)] overflow-x-auto">
{`const BOMBSELL_API_KEY = 'bsk_agt_xxxxxxxx'

async function watchMarket(icp) {
  const res = await fetch('https://bombsell.com/api/v1/signals', {
    headers: { Authorization: \`Bearer \${BOMBSELL_API_KEY}\` },
  })
  return res.json()
}

// Use as a LangGraph tool
const tools = [{
  name: 'watch_market',
  func: watchMarket,
  description: 'Get latest market signals for the ICP',
}]`}
        </pre>
      </div>
    </div>
  )
}

function ApiSection() {
  return (
    <div className="space-y-6">
      {/* Auth */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-[var(--color-text-1)] mb-3">Authentication</h3>
        <p className="text-[14px] leading-[1.65] text-[var(--color-text-2)]">
          All A2A endpoints require an <code className="font-mono text-[13px] bg-[var(--color-ink-2)] px-1 rounded">Authorization: Bearer</code> header.
        </p>
        <div className="mt-3 space-y-2 text-[13px] text-[var(--color-text-2)]">
          <p><strong className="text-[var(--color-text-1)]">Base URL:</strong> <code className="font-mono">https://bombsell.com/api/v1</code></p>
          <p><strong className="text-[var(--color-text-1)]">Agent key format:</strong> <code className="font-mono">bsk_agt_xxxxxxxx...</code></p>
          <p><strong className="text-[var(--color-text-1)]">Scopes:</strong> <code className="font-mono">read:signals</code>, <code className="font-mono">read:accounts</code>, <code className="font-mono">write:outreach</code></p>
        </div>
      </div>

      {/* Rate limits */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-[var(--color-text-1)] mb-3">Rate Limits</h3>
        <p className="text-[13px] text-[var(--color-text-2)] mb-3">
          Every response includes rate limit headers. Exceeding limits returns <code className="font-mono">429</code>.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[var(--color-line-1)]">
                <th className="text-left py-2 font-medium text-[var(--color-text-3)]">Tier</th>
                <th className="text-right py-2 font-medium text-[var(--color-text-3)]">/min</th>
                <th className="text-right py-2 font-medium text-[var(--color-text-3)]">/hour</th>
                <th className="text-right py-2 font-medium text-[var(--color-text-3)]">/day</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Launch', '10', '100', '1,000'],
                ['Growth', '60', '1,000', '10,000'],
                ['Scale', '300', '5,000', '50,000'],
                ['Enterprise', 'Unlimited', 'Unlimited', 'Unlimited'],
              ].map(([tier, min, hr, day]) => (
                <tr key={tier} className="border-b border-[var(--color-line-1)]">
                  <td className="py-2 text-[var(--color-text-1)]">{tier}</td>
                  <td className="py-2 text-right font-mono text-[var(--color-text-2)]">{min}</td>
                  <td className="py-2 text-right font-mono text-[var(--color-text-2)]">{hr}</td>
                  <td className="py-2 text-right font-mono text-[var(--color-text-2)]">{day}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 card p-3 bg-[var(--color-ink-2)]/30">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)] mb-1">Response Headers</p>
          <code className="block text-[11px] font-mono text-[var(--color-text-1)]">
            X-RateLimit-Limit: 60<br/>
            X-RateLimit-Remaining: 47<br/>
            X-RateLimit-Reset: 1715078400
          </code>
        </div>
      </div>

      {/* Error codes */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-[var(--color-text-1)] mb-3">Error Codes</h3>
        <div className="space-y-2 text-[13px]">
          {[
            { code: '401', desc: 'Invalid or missing API key', body: '{ "error": "Invalid API key" }' },
            { code: '402', desc: 'Insufficient agent credits', body: '{ "error": "Insufficient agent credits", "balance": 0.5 }' },
            { code: '403', desc: 'Missing required scope', body: '{ "error": "Missing scope: write:outreach" }' },
            { code: '429', desc: 'Rate limit exceeded', body: '{ "error": "Rate limit exceeded", "reset_at": 1715078400, "window": "minute" }' },
          ].map(err => (
            <div key={err.code} className="flex items-start gap-3 card p-3">
              <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[var(--color-sig-regulation-bg)] text-[var(--color-sig-regulation)] shrink-0">{err.code}</span>
              <div className="min-w-0">
                <p className="text-[var(--color-text-1)]">{err.desc}</p>
                <code className="block text-[11px] font-mono text-[var(--color-text-3)] mt-0.5">{err.body}</code>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Endpoints */}
      <ApiEndpoint
        method="GET"
        path="/signals"
        auth="Agent API key"
        scopes="read:signals"
        cost="0.05 credits per signal delivered"
        description="List recent market signals matching the agent's ICP. Signals are ordered by creation date descending."
        query={[
          { name: 'limit', type: 'number', default: '20', range: '1-100', desc: 'Number of signals to return' },
          { name: 'min_score', type: 'number', default: '7', range: '1-10', desc: 'Minimum relevance score filter' },
          { name: 'origin', type: 'string', default: 'all', desc: 'Filter by origin: live, explore, crm_import' },
        ]}
        response={{
          signals: 'Array of signal objects with company, score, contact, and status fields',
          count: 'Number of signals returned',
          cost_basis: '{ action, credits, unit }',
          balance_after: 'Remaining agent credits',
          transaction_id: 'UUID of the credit transaction',
        }}
        exampleRequest={`curl https://bombsell.com/api/v1/signals?limit=10&min_score=8 \\
  -H "Authorization: Bearer bsk_agt_xxxxxxxx"`}
        exampleResponse={`{
  "signals": [
    {
      "id": "lead_uuid",
      "target_company": "Acme Robotics",
      "company_domain": "acme.com",
      "relevance_score": 9.2,
      "relevance_reason": "Series B funding matched ICP",
      "status": "new",
      "contact_email": "jane@acme.com",
      "contact_name": "Jane Doe",
      "contact_title": "CEO",
      "created_at": "2026-05-07T08:30:00Z"
    }
  ],
  "count": 1,
  "cost_basis": { "action": "signal_delivered", "credits": 0.05, "unit": "signal" },
  "balance_after": 47.45,
  "transaction_id": "tx_uuid"
}`}
      />

      <ApiEndpoint
        method="POST"
        path="/accounts/reason"
        auth="Agent API key"
        scopes="read:accounts"
        cost="0.25 credits per call"
        description="Analyze a target account and return a structured verdict with timing, quality, and accuracy scores. Includes guardrail attestations and recommended action."
        body={[
          { name: 'company_domain', type: 'string', required: true, desc: 'Domain of the target company (e.g. "acme.com")' },
          { name: 'company_name', type: 'string', required: false, desc: 'Optional company name for better matching' },
          { name: 'context', type: 'string', required: false, desc: 'Additional context (e.g. "downloaded whitepaper yesterday")' },
        ]}
        response={{
          verdict: '"proceed", "hold", or "reject"',
          confidence: '0.0 to 1.0',
          scores: '{ timing, quality, accuracy } each 0.0-1.0',
          why_now: '{ signal, trigger, urgency, expires_at }',
          recommended_action: '{ type, persona, angle, proof_point }',
          verified_contact: '{ found, name, title, email } or { found: false }',
          guardrails_passed: 'Array of { type, passed, evidence }',
          cost_basis: '{ action, credits, unit }',
          balance_after: 'Remaining credits',
          transaction_id: 'UUID',
          audit_hash: 'HMAC-SHA256 attestation hash',
        }}
        exampleRequest={`curl -X POST https://bombsell.com/api/v1/accounts/reason \\
  -H "Authorization: Bearer bsk_agt_xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"company_domain": "acme.com", "context": "Series B last week"}'`}
        exampleResponse={`{
  "verdict": "proceed",
  "confidence": 0.91,
  "scores": { "timing": 0.94, "quality": 0.88, "accuracy": 0.91 },
  "why_now": {
    "signal": "Series B funding detected 2 days ago",
    "trigger": "funding",
    "urgency": "high",
    "expires_at": "2026-05-14T00:00:00Z"
  },
  "recommended_action": {
    "type": "founder_outreach",
    "persona": "founder",
    "angle": "congratulate_on_funding",
    "proof_point": "hiring_velocity"
  },
  "verified_contact": {
    "found": true,
    "name": "Jane Doe",
    "title": "CEO",
    "email": "jane@acme.com"
  },
  "guardrails_passed": [
    { "type": "icp_matched", "passed": true, "evidence": { "score": 9.2 } },
    { "type": "contact_verified", "passed": true, "evidence": { "source": "provider" } },
    { "type": "timing_appropriate", "passed": true, "evidence": { "age_days": 2 } }
  ],
  "cost_basis": { "action": "account_reasoned", "credits": 0.25, "unit": "call" },
  "balance_after": 47.5,
  "transaction_id": "tx_uuid",
  "audit_hash": "sha256:abc123..."
}`}
      />

      <ApiEndpoint
        method="POST"
        path="/outreach/execute"
        auth="Agent API key"
        scopes="write:outreach"
        cost="1.00 credit per send"
        description="Execute safe outreach with full guardrails. Agents default to approve-first mode — outreach is queued for human review unless autopilot is explicitly enabled."
        body={[
          { name: 'company_domain', type: 'string', required: true, desc: 'Target company domain' },
          { name: 'contact_email', type: 'string', required: true, desc: 'Verified contact email' },
          { name: 'message_body', type: 'string', required: true, desc: 'Outreach message (max 2000 chars)' },
          { name: 'channel', type: 'string', required: false, default: 'email', desc: 'email | linkedin | x' },
          { name: 'approval_mode', type: 'string', required: false, default: 'approve_first', desc: 'autopilot | approve_first' },
        ]}
        response={{
          verdict: '"queued" or "delivered"',
          message_id: 'UUID for tracking',
          delivery_status: '"pending_approval" or "sent"',
          guardrails: '{ all_passed, attestations[] }',
          cost_basis: '{ action, credits, unit }',
          balance_after: 'Remaining credits',
          transaction_id: 'UUID',
          audit_hash: 'HMAC-SHA256 hash',
        }}
        exampleRequest={`curl -X POST https://bombsell.com/api/v1/outreach/execute \\
  -H "Authorization: Bearer bsk_agt_xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "company_domain": "acme.com",
    "contact_email": "jane@acme.com",
    "message_body": "Hi Jane, congratulations on the Series B...",
    "channel": "email",
    "approval_mode": "approve_first"
  }'`}
        exampleResponse={`{
  "verdict": "queued",
  "message_id": "msg_uuid",
  "delivery_status": "pending_approval",
  "note": "Agent outreach queued for human review.",
  "guardrails": {
    "all_passed": true,
    "attestations": [
      { "type": "contact_verified", "passed": true, "evidence": { "email": "jane@acme.com" } },
      { "type": "unsubscribe_checked", "passed": true, "evidence": { "list_status": "clean" } },
      { "type": "bounce_safe", "passed": true, "evidence": { "domain_reputation": 98 } },
      { "type": "daily_cap_respected", "passed": true, "evidence": { "sends_today": 3, "cap": 10 } },
      { "type": "spam_score_safe", "passed": true, "evidence": { "spam_score": 2, "threshold": 5 } }
    ]
  },
  "cost_basis": { "action": "outreach_executed", "credits": 1.00, "unit": "send" },
  "balance_after": 46.5,
  "transaction_id": "tx_uuid",
  "audit_hash": "sha256:def456..."
}`}
      />

      {/* Human management endpoints */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-[var(--color-text-1)] mb-3">Agent Management (Human Auth)</h3>
        <p className="text-[13px] text-[var(--color-text-2)] mb-4">
          These endpoints require your Supabase session token (Google sign-in), not an agent API key. Use them to register agents, create keys, and manage wallets.
        </p>

        <div className="space-y-3">
          {[
            {
              method: 'GET', path: '/api/agents', auth: 'Session',
              desc: 'List all your registered agents',
              response: '{ agents: [{ id, name, provider, principal_email, is_active }] }',
            },
            {
              method: 'POST', path: '/api/agents', auth: 'Session',
              desc: 'Register a new agent identity',
              body: '{ name, provider, principal_email?, metadata? }',
              response: '{ agent: { id, name, ... } }',
            },
            {
              method: 'GET', path: '/api/agents/keys?agent_id=xxx', auth: 'Session',
              desc: 'List API keys for an agent',
              response: '{ keys: [{ id, key_prefix, name, scopes, last_used_at }] }',
            },
            {
              method: 'POST', path: '/api/agents/keys', auth: 'Session',
              desc: 'Create a new scoped API key (returns full key once)',
              body: '{ agent_id, name, scopes?, expires_at? }',
              response: '{ key, api_key: "bsk_agt_..." }',
            },
            {
              method: 'DELETE', path: '/api/agents/keys', auth: 'Session',
              desc: 'Revoke an API key',
              body: '{ key_id }',
              response: '{ ok: true }',
            },
            {
              method: 'GET', path: '/api/agents/wallet?agent_id=xxx', auth: 'Session',
              desc: 'Check agent wallet balance and transactions',
              response: '{ wallet: { balance, total_consumed, total_earned }, transactions: [] }',
            },
            {
              method: 'POST', path: '/api/agents/wallet', auth: 'Session',
              desc: 'Transfer credits from your wallet to agent wallet',
              body: '{ agent_id, amount }',
              response: '{ transferred, agent_balance, human_balance_remaining }',
            },
          ].map(ep => (
            <div key={`${ep.method} ${ep.path}`} className="card p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  ep.method === 'GET' ? 'bg-[var(--color-pillar-accuracy-bg)] text-[var(--color-pillar-accuracy)]' : ep.method === 'DELETE' ? 'bg-[var(--color-sig-regulation-bg)] text-[var(--color-sig-regulation)]' : 'bg-[var(--color-pillar-timing-bg)] text-[var(--color-pillar-timing)]'
                }`}>{ep.method}</span>
                <code className="text-[11px] font-mono text-[var(--color-text-1)]">{ep.path}</code>
                <span className="text-[10px] text-[var(--color-text-4)] ml-auto">Auth: {ep.auth}</span>
              </div>
              <p className="text-[11px] text-[var(--color-text-3)]">{ep.desc}</p>
              {ep.body && <code className="block text-[10px] font-mono text-[var(--color-text-3)] mt-0.5">Body: {ep.body}</code>}
              <code className="block text-[10px] font-mono text-[var(--color-text-3)] mt-0.5">Resp: {ep.response}</code>
            </div>
          ))}
        </div>
      </div>

      {/* Webhooks */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-[var(--color-text-1)] mb-3">Webhook Verification</h3>
        <p className="text-[13px] text-[var(--color-text-2)] mb-3">
          When Bombsell delivers signals via webhook, the payload is HMAC-SHA256 signed. Verify signatures to ensure authenticity.
        </p>
        <div className="card p-3 bg-[var(--color-ink-2)]/30 mb-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)] mb-1">Request Headers</p>
          <code className="block text-[11px] font-mono text-[var(--color-text-1)]">
            X-Bombsell-Signature: sha256=abc123...<br/>
            X-Bombsell-Event: signal.new<br/>
            X-Bombsell-Subscription: sub_uuid
          </code>
        </div>
        <div className="card p-3 bg-[var(--color-ink-2)]/30">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)] mb-1">Verification (Node.js)</p>
          <pre className="text-[11px] font-mono text-[var(--color-text-1)] overflow-x-auto">
{`const crypto = require('crypto')

function verifyWebhook(payload, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex')
  return signature === expected
}`}
          </pre>
        </div>
      </div>
    </div>
  )
}

function ApiEndpoint({
  method,
  path,
  auth,
  scopes,
  cost,
  description,
  query,
  body,
  response,
  exampleRequest,
  exampleResponse,
}: {
  method: string
  path: string
  auth: string
  scopes: string
  cost: string
  description: string
  query?: { name: string; type: string; required?: boolean; default?: string; range?: string; desc: string }[]
  body?: { name: string; type: string; required: boolean; default?: string; desc: string }[]
  response: Record<string, string>
  exampleRequest: string
  exampleResponse: string
}) {
  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/30">
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
            method === 'GET' ? 'bg-[var(--color-pillar-accuracy-bg)] text-[var(--color-pillar-accuracy)]' : 'bg-[var(--color-pillar-timing-bg)] text-[var(--color-pillar-timing)]'
          }`}>{method}</span>
          <code className="text-[13px] font-mono text-[var(--color-text-1)]">{path}</code>
        </div>
        <p className="text-[13px] text-[var(--color-text-2)]">{description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
          <span className="text-[var(--color-text-3)]">Auth: <span className="text-[var(--color-text-1)]">{auth}</span></span>
          <span className="text-[var(--color-text-3)]">Scopes: <code className="font-mono text-[var(--color-accent-ring)]">{scopes}</code></span>
          <span className="text-[var(--color-text-3)]">Cost: <span className="font-mono text-[var(--color-accent-ring)]">{cost}</span></span>
        </div>
      </div>

      {/* Query params */}
      {query && query.length > 0 && (
        <div className="px-5 py-3 border-b border-[var(--color-line-1)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)] mb-2">Query Parameters</p>
          <div className="space-y-1.5">
            {query.map(p => (
              <div key={p.name} className="flex items-start gap-2 text-[12px]">
                <code className="font-mono text-[var(--color-text-1)] shrink-0 w-24">{p.name}</code>
                <span className="text-[var(--color-text-3)]">{p.type}</span>
                {p.required !== undefined && <span className="text-[var(--color-text-4)]">{p.required ? 'required' : 'optional'}</span>}
                {p.default && <span className="text-[var(--color-text-4)]">default: {p.default}</span>}
                {p.range && <span className="text-[var(--color-text-4)]">range: {p.range}</span>}
                <span className="text-[var(--color-text-3)] ml-auto text-right">{p.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Body params */}
      {body && body.length > 0 && (
        <div className="px-5 py-3 border-b border-[var(--color-line-1)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)] mb-2">Request Body</p>
          <div className="space-y-1.5">
            {body.map(p => (
              <div key={p.name} className="flex items-start gap-2 text-[12px]">
                <code className="font-mono text-[var(--color-text-1)] shrink-0 w-28">{p.name}</code>
                <span className="text-[var(--color-text-3)]">{p.type}</span>
                <span className="text-[var(--color-text-4)]">{p.required ? 'required' : 'optional'}</span>
                {p.default && <span className="text-[var(--color-text-4)]">default: {p.default}</span>}
                <span className="text-[var(--color-text-3)] ml-auto text-right">{p.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Response fields */}
      <div className="px-5 py-3 border-b border-[var(--color-line-1)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)] mb-2">Response Fields</p>
        <div className="space-y-1">
          {Object.entries(response).map(([key, desc]) => (
            <div key={key} className="flex items-start gap-2 text-[12px]">
              <code className="font-mono text-[var(--color-accent-ring)] shrink-0 w-28">{key}</code>
              <span className="text-[var(--color-text-3)]">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Examples */}
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[var(--color-line-1)]">
        <div className="p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)] mb-2">Example Request</p>
          <pre className="text-[11px] font-mono text-[var(--color-text-1)] overflow-x-auto">{exampleRequest}</pre>
        </div>
        <div className="p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)] mb-2">Example Response</p>
          <pre className="text-[11px] font-mono text-[var(--color-text-1)] overflow-x-auto">{exampleResponse}</pre>
        </div>
      </div>
    </div>
  )
}
