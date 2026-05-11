import Link from 'next/link'
import Icon from '@/components/Icon'

export const metadata = {
  title: 'API Docs · Bombsell',
  description: 'A2A-compatible GTM infrastructure: discover agents, dispatch tasks, run workflows, receive webhooks, manage keys.',
}

/* ─── Spec (mirrors /api/docs/agents) ─────────────────────────── */

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'
type Endpoint = {
  method: Method
  path: string
  summary: string
  params?: Array<{ name: string; in: 'path' | 'query'; required?: boolean; desc: string }>
  body?: { required?: boolean; fields: Array<{ name: string; type: string; required?: boolean; desc: string }> }
  responses: Array<{ code: number; desc: string }>
  auth?: 'AgentKey' | 'Session'
}
type Group = { id: string; title: string; blurb: string; endpoints: Endpoint[] }

const GROUPS: Group[] = [
  {
    id: 'agents',
    title: 'Agents',
    blurb: 'Discover system agents, inspect health, and dispatch single-agent tasks. Manage external agent identities for your workspace.',
    endpoints: [
      { method: 'GET', path: '/api/a2a/agents', summary: 'List system agents', responses: [{ code: 200, desc: 'Registered agent profiles and health state.' }] },
      { method: 'GET', path: '/api/agents/{role}', summary: 'Inspect a system agent by role', params: [{ name: 'role', in: 'path', required: true, desc: 'Agent role identifier.' }], responses: [{ code: 200, desc: 'Agent profile, capabilities, version, and health.' }, { code: 404, desc: 'Unknown role.' }] },
      { method: 'POST', path: '/api/agents/{role}/dispatch', summary: 'Dispatch a task to one system agent', auth: 'AgentKey', params: [{ name: 'role', in: 'path', required: true, desc: 'Agent role identifier.' }], body: { required: true, fields: [{ name: 'tool', type: 'string', required: true, desc: 'Tool name the agent exposes.' }, { name: 'arguments', type: 'object', required: true, desc: 'Tool arguments.' }] }, responses: [{ code: 200, desc: 'Task result.' }, { code: 401, desc: 'Unauthorized.' }, { code: 404, desc: 'Unknown role.' }] },
      { method: 'GET', path: '/api/agents', summary: 'List external agent identities for the signed-in workspace', auth: 'Session', responses: [{ code: 200, desc: 'Agent identities.' }] },
      { method: 'POST', path: '/api/agents', summary: 'Register an external agent identity', auth: 'Session', responses: [{ code: 201, desc: 'Agent identity created.' }] },
    ],
  },
  {
    id: 'workflows',
    title: 'Workflows / Engines',
    blurb: 'List pipeline definitions and dispatch them. The two canonical engine pipelines are "outbound" (signal → match → enrich → safety → draft → send → reply → book / follow-up) and "content" (idea → write → edit → schedule → publish → learn). Steps run only for agents the workspace has enabled, and acting steps respect each agent\'s autonomy mode (research-only / approve-first / autopilot). Legacy presets (full-funnel, signal-to-insight, enrich-and-outreach, reply-handling) remain available.',
    endpoints: [
      { method: 'GET', path: '/api/a2a/workflows', summary: 'List pipeline / workflow definitions', responses: [{ code: 200, desc: 'Available pipeline definitions, with engine + step lists.' }] },
      { method: 'POST', path: '/api/a2a/workflows', summary: 'Dispatch a pipeline', auth: 'AgentKey', body: { required: true, fields: [{ name: 'workflow', type: "'outbound' | 'content' | 'full-funnel' | 'signal-to-insight' | 'enrich-and-outreach' | 'reply-handling'", required: true, desc: 'Pipeline to run.' }, { name: 'context', type: 'object', desc: 'Optional input context (leadId / postId / companyName / companyDomain).' }] }, responses: [{ code: 200, desc: 'Pipeline run result — per-step outcomes, including skipped/awaiting-approval.' }, { code: 400, desc: 'Invalid request.' }, { code: 401, desc: 'Unauthorized.' }] },
    ],
  },
  {
    id: 'content',
    title: 'Content engine (LinkedIn / X)',
    blurb: 'Composable content agents: idea generation, writing, editing, scheduling/publishing (via a posting partner), engagement tracking, and repurposing. Each runs independently — dispatch its tool against /api/agents/{role}/dispatch with { tool, arguments }, or run them together via the "content" pipeline.',
    endpoints: [
      { method: 'POST', path: '/api/agents/idea/dispatch', summary: 'idea: generate scored content angles from signals & positioning', auth: 'AgentKey', body: { required: true, fields: [{ name: 'tool', type: "'bombsell.idea.generate' | 'bombsell.idea.list'", required: true, desc: 'Idea tool.' }, { name: 'arguments', type: '{ count?, platform?, topic? }', desc: 'Tool arguments.' }] }, responses: [{ code: 200, desc: 'Generated ideas (written to content_ideas).' }] },
      { method: 'POST', path: '/api/agents/writer/dispatch', summary: 'writer: draft a post from an idea / expand into a thread', auth: 'AgentKey', body: { required: true, fields: [{ name: 'tool', type: "'bombsell.content.write' | 'bombsell.content.thread'", required: true, desc: 'Writer tool.' }, { name: 'arguments', type: '{ ideaId } | { postId }', desc: 'Tool arguments.' }] }, responses: [{ code: 200, desc: 'Post draft (written to posts).' }] },
      { method: 'POST', path: '/api/agents/editor/dispatch', summary: 'editor: brand-voice & format pass + pre-publish eval', auth: 'AgentKey', body: { required: true, fields: [{ name: 'tool', type: "'bombsell.content.edit'", required: true, desc: 'Editor tool.' }, { name: 'arguments', type: '{ postId }', desc: 'Tool arguments.' }] }, responses: [{ code: 200, desc: 'Updated post with eval score.' }] },
      { method: 'POST', path: '/api/agents/publisher/dispatch', summary: 'publisher: schedule / publish via the posting partner', auth: 'AgentKey', body: { required: true, fields: [{ name: 'tool', type: "'bombsell.content.schedule' | 'bombsell.content.publish'", required: true, desc: 'Publisher tool.' }, { name: 'arguments', type: '{ postId, scheduledAt? }', desc: 'Tool arguments.' }] }, responses: [{ code: 200, desc: 'Publish result (status, partner ids).' }] },
      { method: 'POST', path: '/api/agents/engagement/dispatch', summary: 'engagement: pull impressions/likes/replies, attribute outcomes', auth: 'AgentKey', body: { required: true, fields: [{ name: 'tool', type: "'bombsell.content.metrics'", required: true, desc: 'Engagement tool.' }, { name: 'arguments', type: '{ postId?, limit? }', desc: 'Tool arguments.' }] }, responses: [{ code: 200, desc: 'Posts whose metrics were refreshed.' }] },
      { method: 'POST', path: '/api/agents/repurpose/dispatch', summary: 'repurpose: turn a top post into a fresh idea', auth: 'AgentKey', body: { required: true, fields: [{ name: 'tool', type: "'bombsell.content.repurpose'", required: true, desc: 'Repurpose tool.' }, { name: 'arguments', type: '{ postId? }', desc: 'Tool arguments.' }] }, responses: [{ code: 200, desc: 'New content idea derived from the source post.' }] },
    ],
  },
  {
    id: 'keys',
    title: 'Keys & Wallet',
    blurb: 'Issue and revoke API keys for external agent identities, and manage per-agent credit wallets. Raw secrets are returned once, on create.',
    endpoints: [
      { method: 'GET', path: '/api/agents/keys', summary: 'List API keys for an external agent identity', auth: 'Session', params: [{ name: 'agent_id', in: 'query', required: true, desc: 'Agent identity id.' }], responses: [{ code: 200, desc: 'Key metadata. Raw secret is never returned.' }] },
      { method: 'POST', path: '/api/agents/keys', summary: 'Create an API key for an external agent identity', auth: 'Session', responses: [{ code: 201, desc: 'Key metadata plus one-time raw api_key.' }] },
      { method: 'DELETE', path: '/api/agents/keys', summary: 'Revoke an API key', auth: 'Session', responses: [{ code: 200, desc: 'Revoked.' }] },
      { method: 'GET', path: '/api/agents/wallet', summary: 'Inspect an agent wallet', auth: 'Session', params: [{ name: 'agent_id', in: 'query', required: true, desc: 'Agent identity id.' }], responses: [{ code: 200, desc: 'Wallet balance and auto top-up state.' }] },
      { method: 'POST', path: '/api/agents/wallet', summary: 'Top up an agent wallet', auth: 'Session', responses: [{ code: 200, desc: 'Updated wallet.' }] },
    ],
  },
  {
    id: 'events',
    title: 'Events',
    blurb: 'Pull the recent agent event stream for your workspace — task starts, completions, errors, and workflow transitions.',
    endpoints: [
      { method: 'GET', path: '/api/agents/events', summary: 'List recent agent events for the signed-in workspace', auth: 'Session', params: [{ name: 'limit', in: 'query', desc: 'Max rows, 1–100. Default 30.' }], responses: [{ code: 200, desc: 'Recent event rows.' }] },
    ],
  },
  {
    id: 'webhooks',
    title: 'Webhooks',
    blurb: 'Receive external agent task results and manage webhook subscriptions. Inbound deliveries are signature-verified.',
    endpoints: [
      { method: 'GET', path: '/api/agents/webhook', summary: 'Webhook endpoint metadata', responses: [{ code: 200, desc: 'Webhook endpoint information.' }] },
      { method: 'POST', path: '/api/agents/webhook', summary: 'Receive external agent task results', auth: 'AgentKey', responses: [{ code: 200, desc: 'Accepted.' }] },
      { method: 'GET', path: '/api/agents/webhooks', summary: 'List webhook subscriptions', auth: 'Session', responses: [{ code: 200, desc: 'Webhook subscriptions.' }] },
      { method: 'POST', path: '/api/agents/webhooks', summary: 'Create webhook subscription', auth: 'Session', responses: [{ code: 201, desc: 'Webhook subscription created.' }] },
      { method: 'DELETE', path: '/api/agents/webhooks', summary: 'Delete webhook subscription', auth: 'Session', responses: [{ code: 200, desc: 'Deleted.' }] },
    ],
  },
]

const METHOD_TONE: Record<Method, string> = {
  GET: 'text-tertiary border-tertiary/30 bg-tertiary/5',
  POST: 'text-primary border-primary/30 bg-primary/5',
  PATCH: 'text-secondary border-secondary/30 bg-secondary/5',
  DELETE: 'text-error border-error/30 bg-error/5',
}

/* ─── Page ────────────────────────────────────────────────────── */

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-surface text-on-surface font-body-main">
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md border-b border-outline-variant/30">
        <div className="flex items-center justify-between h-16 px-margin-page max-w-[1280px] mx-auto">
          <Link href="/" className="font-h1-editorial text-h1-editorial italic text-on-surface">Bombsell</Link>
          <div className="flex items-center gap-stack-lg">
            <Link href="/" className="font-body-main text-body-main text-on-surface-variant hover:text-primary transition-colors">Home</Link>
            <a href="/api/docs/agents" className="font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant hover:text-primary transition-colors inline-flex items-center gap-2">
              <Icon name="data_object" size={14} /> OpenAPI JSON
            </a>
          </div>
        </div>
      </header>

      <div className="max-w-[1280px] mx-auto px-margin-page flex gap-stack-lg">
        {/* TOC */}
        <aside className="hidden lg:block w-56 shrink-0 py-section-gap">
          <nav className="sticky top-24 space-y-1">
            <p className="font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant mb-4">Reference</p>
            <a href="#overview" className="block py-1.5 text-body-main text-on-surface-variant hover:text-primary transition-colors">Overview</a>
            <a href="#auth" className="block py-1.5 text-body-main text-on-surface-variant hover:text-primary transition-colors">Authentication</a>
            {GROUPS.map(g => (
              <a key={g.id} href={`#${g.id}`} className="block py-1.5 text-body-main text-on-surface-variant hover:text-primary transition-colors">{g.title}</a>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0 py-section-gap max-w-3xl">
          <section id="overview" className="scroll-mt-24">
            <p className="font-label-mono text-label-mono uppercase tracking-widest text-primary mb-3">Bombsell Agent API · v1.0.0</p>
            <h1 className="font-h1-editorial text-[56px] leading-tight text-on-surface mb-stack-md">API documentation</h1>
            <p className="font-body-large text-body-large text-on-surface-variant leading-relaxed">
              A2A-compatible GTM infrastructure. Discover agents, dispatch single-agent tasks, run multi-agent workflows,
              receive webhooks, and manage agent keys — all over plain HTTP/JSON.
            </p>
            <div className="mt-stack-lg grid sm:grid-cols-2 gap-px bg-outline-variant/30 border border-outline-variant/30">
              <div className="bg-surface-container-lowest p-stack-md">
                <p className="font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant mb-2">Base URL</p>
                <code className="font-label-mono text-body-main text-on-surface">https://bombsell.com</code>
              </div>
              <div className="bg-surface-container-lowest p-stack-md">
                <p className="font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant mb-2">Local</p>
                <code className="font-label-mono text-body-main text-on-surface">http://localhost:3000</code>
              </div>
            </div>
            <p className="mt-stack-md font-body-main text-body-main text-on-surface-variant">
              Machine-readable spec: <a href="/api/docs/agents" className="text-primary hover:underline">OpenAPI 3.0.3 JSON</a>.
            </p>
          </section>

          <section id="auth" className="scroll-mt-24 mt-section-gap">
            <h2 className="font-h1-editorial text-[34px] leading-tight text-on-surface mb-stack-md">Authentication</h2>
            <p className="font-body-main text-body-main text-on-surface-variant leading-relaxed mb-stack-md">
              Two schemes, both bearer tokens in the <code className="font-label-mono text-on-surface">Authorization</code> header.
            </p>
            <div className="space-y-px bg-outline-variant/30 border border-outline-variant/30">
              <div className="bg-surface-container-lowest p-stack-md">
                <p className="font-label-mono text-label-mono uppercase tracking-widest text-primary mb-1">AgentKey</p>
                <p className="font-body-main text-body-main text-on-surface-variant">Use the one-time key returned by <code className="font-label-mono text-on-surface">POST /api/agents/keys</code>. For agent-to-agent calls — dispatch, workflows, inbound webhooks.</p>
              </div>
              <div className="bg-surface-container-lowest p-stack-md">
                <p className="font-label-mono text-label-mono uppercase tracking-widest text-secondary mb-1">Session</p>
                <p className="font-body-main text-body-main text-on-surface-variant">Signed-in workspace session. For workspace-scoped management endpoints — identities, keys, wallets, events, webhook subscriptions.</p>
              </div>
            </div>
            <pre className="mt-stack-md bg-[#1A1816] text-[#e8d9d3] p-stack-md overflow-x-auto text-[13px] leading-relaxed">
{`curl https://bombsell.com/api/a2a/workflows \\
  -X POST \\
  -H "Authorization: Bearer ak_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{ "workflow": "full-funnel", "context": { "domain": "acme.com" } }'`}
            </pre>
          </section>

          {GROUPS.map(g => (
            <section key={g.id} id={g.id} className="scroll-mt-24 mt-section-gap">
              <h2 className="font-h1-editorial text-[34px] leading-tight text-on-surface mb-stack-sm">{g.title}</h2>
              <p className="font-body-main text-body-main text-on-surface-variant leading-relaxed mb-stack-lg max-w-2xl">{g.blurb}</p>
              <div className="space-y-stack-md">
                {g.endpoints.map(ep => <EndpointCard key={ep.method + ep.path} ep={ep} />)}
              </div>
            </section>
          ))}

          <footer className="mt-section-gap pt-stack-lg border-t border-outline-variant/30 flex items-center justify-between">
            <span className="font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant">Bombsell · Agentic GTM</span>
            <Link href="/" className="font-label-mono text-label-mono uppercase tracking-widest text-primary hover:underline inline-flex items-center gap-2">
              <Icon name="arrow_back" size={14} /> Back home
            </Link>
          </footer>
        </main>
      </div>
    </div>
  )
}

function EndpointCard({ ep }: { ep: Endpoint }) {
  return (
    <div className="border border-outline-variant/30 bg-surface-container-lowest">
      <div className="flex items-center gap-stack-md p-stack-md border-b border-outline-variant/20">
        <span className={`font-label-mono text-[11px] uppercase tracking-widest px-2 py-1 border ${METHOD_TONE[ep.method]}`}>{ep.method}</span>
        <code className="font-label-mono text-body-main text-on-surface break-all">{ep.path}</code>
        {ep.auth && (
          <span className="ml-auto font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant inline-flex items-center gap-1">
            <Icon name="lock" size={12} /> {ep.auth}
          </span>
        )}
      </div>
      <div className="p-stack-md space-y-stack-md">
        <p className="font-body-main text-body-main text-on-surface">{ep.summary}</p>

        {ep.params && (
          <div>
            <p className="font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant mb-2">Parameters</p>
            <div className="space-y-2">
              {ep.params.map(p => (
                <div key={p.name} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                  <code className="font-label-mono text-on-surface">{p.name}</code>
                  <span className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant">{p.in}{p.required ? ' · required' : ''}</span>
                  <span className="text-on-surface-variant">{p.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {ep.body && (
          <div>
            <p className="font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant mb-2">Request body{ep.body.required ? ' · required' : ''}</p>
            <div className="space-y-2">
              {ep.body.fields.map(f => (
                <div key={f.name} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                  <code className="font-label-mono text-on-surface">{f.name}</code>
                  <code className="font-label-mono text-[12px] text-tertiary">{f.type}</code>
                  {f.required && <span className="font-label-mono text-[10px] uppercase tracking-widest text-primary">required</span>}
                  <span className="text-on-surface-variant">{f.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant mb-2">Responses</p>
          <div className="space-y-1.5">
            {ep.responses.map(r => (
              <div key={r.code} className="flex items-baseline gap-3 text-[13px]">
                <code className={`font-label-mono ${r.code < 300 ? 'text-tertiary' : r.code < 500 ? 'text-secondary' : 'text-error'}`}>{r.code}</code>
                <span className="text-on-surface-variant">{r.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
