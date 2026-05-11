'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { UserProfile } from './types'
import Icon from '@/components/Icon'

interface Props { profile: UserProfile }

/**
 * Fleet — the system view, styled after the Stitch "Fleet Dashboard" and
 * "Loop Workflows" screens.
 *
 *   Fleet     → 11-agent fleet table (status · activity · state)
 *   Workflows → active-workflow cards + automation-pipelines table + command bar
 *   Activity  → live event stream
 */
type AgentsTab = 'config' | 'fleet' | 'workflows' | 'activity'

export default function AgentsView({ profile }: Props) {
  const [tab, setTab] = useState<AgentsTab>('config')
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([])

  useEffect(() => {
    void fetch('/api/a2a/agents').then(r => r.json()).then(d => {
      setAgents(Array.isArray(d?.agents) ? d.agents.map(asAgentRow) : [])
    }).catch(() => {})
    void fetch('/api/a2a/workflows').then(r => r.json()).then(d => {
      setWorkflows(Array.isArray(d?.workflows) ? d.workflows : [])
    }).catch(() => {})
  }, [])

  const running = agents.filter(a => a.status === 'running').length

  return (
    <div className="space-y-section-gap">
      <div className="flex items-start justify-between gap-stack-lg flex-wrap">
        <div>
          <h2 className="font-h1-editorial text-display-sm text-on-surface mb-2">Agents</h2>
          <p className="font-body-main text-on-surface-variant max-w-2xl">
            Every agent runs independently — toggle which ones power {profile.client_name || profile.company_name}&rsquo;s Outbound and Content engines, set how much agency each gets, run pipelines, and watch live activity.
          </p>
        </div>
        <div className="flex items-center gap-1 hairline-border rounded-full p-1">
          {([['config', 'Stacks'], ['fleet', 'Fleet'], ['workflows', 'Pipelines'], ['activity', 'Activity']] as Array<[AgentsTab, string]>).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`h-8 px-4 rounded-full font-label-mono text-label-mono uppercase tracking-wider transition-colors ${
                tab === id ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >{label}</button>
          ))}
        </div>
      </div>

      {tab === 'config' && <AgentStacks />}
      {tab === 'fleet' && <Fleet agents={agents} running={running} />}
      {tab === 'workflows' && <Workflows rows={workflows} />}
      {tab === 'activity' && <Activity />}
    </div>
  )
}

/* ─── Stacks (per-workspace agent config) ─────────────────────── */

interface WsAgent { role: string; engine: 'outbound' | 'content' | 'shared'; enabled: boolean; autonomy: 'research_only' | 'approve_first' | 'autopilot'; name: string; description: string; capabilities: string[] }
const ENGINE_LABEL: Record<string, string> = { outbound: 'Outbound engine', content: 'Content engine', shared: 'Shared · add-ons · control' }
const ACTING = new Set(['outreach', 'booking', 'followup', 'publisher', 'crm'])

function AgentStacks() {
  const [rows, setRows] = useState<WsAgent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallbackLoad(setRows, setLoaded)
  useEffect(() => { void load() }, [load])

  async function patch(role: string, body: Record<string, unknown>) {
    setSaving(role)
    setRows(rs => rs.map(r => r.role === role ? { ...r, ...body } as WsAgent : r))
    try {
      await fetch('/api/workspace-agents', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, ...body }) })
    } finally { setSaving(null) }
  }

  if (!loaded) return <div className="bg-surface-container-lowest hairline-border rounded-lg p-12 text-center font-body-main text-on-surface-variant">Loading agents…</div>

  const groups: Array<['outbound' | 'content' | 'shared', WsAgent[]]> = (['outbound', 'content', 'shared'] as const).map(e => [e, rows.filter(r => r.engine === e)])

  return (
    <div className="space-y-stack-lg">
      {groups.map(([engine, list]) => list.length === 0 ? null : (
        <section key={engine}>
          <h3 className="font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant mb-3 hairline-b pb-2">{ENGINE_LABEL[engine]} · {list.filter(a => a.enabled).length}/{list.length} on</h3>
          <div className="space-y-px bg-outline-variant/30 hairline-border">
            {list.map((a) => (
              <div key={a.role} className="bg-surface-container-lowest px-stack-md py-3.5 flex items-center gap-stack-md">
                <button onClick={() => void patch(a.role, { enabled: !a.enabled })} disabled={saving === a.role}
                  className={`w-9 h-5 rounded-full shrink-0 transition-colors relative ${a.enabled ? 'bg-tertiary' : 'bg-outline-variant'}`} aria-label="toggle">
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${a.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-label-mono text-label-mono uppercase text-on-surface">{a.role}-agent</span>
                    {ACTING.has(a.role) && <span className="font-label-mono text-[9px] uppercase text-on-surface-variant" title="acting agent — autonomy applies">acts</span>}
                  </div>
                  <p className="font-body-main text-[13px] text-on-surface-variant truncate">{a.description}</p>
                </div>
                <select value={a.autonomy} onChange={(e) => void patch(a.role, { autonomy: e.target.value })} disabled={saving === a.role || !a.enabled || !ACTING.has(a.role)}
                  className="font-label-mono text-[10px] uppercase bg-surface border border-outline-variant/40 rounded px-2 py-1 disabled:opacity-40 shrink-0">
                  <option value="research_only">Research only</option>
                  <option value="approve_first">Approve first</option>
                  <option value="autopilot">Autopilot</option>
                </select>
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="font-label-mono text-[10px] uppercase text-on-surface-variant">Autonomy applies to acting agents (send / publish / book / follow-up / CRM). Research-only agents always run when enabled.</p>
    </div>
  )
}

// tiny helper to keep the fetch+setState stable without pulling useCallback into the top imports list awkwardly
function useCallbackLoad(setRows: (r: WsAgent[]) => void, setLoaded: (b: boolean) => void) {
  return useCallback(async () => {
    try {
      const d = await fetch('/api/workspace-agents').then(r => r.json())
      if (Array.isArray(d?.agents)) setRows(d.agents)
    } catch { /* ignore */ }
    setLoaded(true)
  }, [setRows, setLoaded])
}

/* ─── Fleet ───────────────────────────────────────────────────── */

function Fleet({ agents, running }: { agents: AgentRow[]; running: number }) {
  if (agents.length === 0) {
    return <div className="bg-surface-container-lowest hairline-border rounded-lg p-12 text-center font-body-main text-on-surface-variant">Loading agents…</div>
  }
  return (
    <div className="bg-surface-container-lowest hairline-border rounded-lg overflow-hidden">
      <div className="bg-surface-container-low/30 px-6 py-3 hairline-b flex justify-between items-center">
        <span className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant">Active Agents • {agents.length} · {running} running</span>
        <div className="flex items-center gap-2 font-label-mono text-[9px] uppercase text-on-surface-variant">
          <Icon name="refresh" size={14} /><span>Auto-update enabled</span>
        </div>
      </div>
      <div className="divide-y divide-[rgba(26,24,22,0.07)]">
        {agents.map((a) => (
          <div key={a.role} className="flex items-center px-6 py-5 hover:bg-surface-container-low transition-colors group">
            <div className="w-44 sm:w-52 flex items-center gap-4 shrink-0">
              <span className={`agent-status-dot ${a.status === 'running' ? 'bg-tertiary' : a.status === 'degraded' ? 'bg-secondary' : 'bg-outline-variant'}`} />
              <span className="font-label-mono text-label-mono uppercase text-on-surface truncate">{a.role}-agent</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-on-surface-variant font-body-main truncate">{a.description || `v${a.version} · ${a.capabilities} tools`}</p>
            </div>
            <div className="w-28 flex justify-end shrink-0">
              <span className={`font-label-mono text-[9px] uppercase tracking-widest px-2 py-1 rounded ${
                a.status === 'running' ? 'bg-tertiary/10 text-tertiary' : 'bg-surface-container-high text-on-surface-variant'
              }`}>{a.status === 'running' ? 'Running' : a.status === 'degraded' ? 'Degraded' : 'Idle'}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface AgentRow {
  role: string; name: string; status: string; version: string; description: string; capabilities: number
}
function asAgentRow(a: unknown): AgentRow {
  const x = a as Record<string, unknown>
  const health = x.health as { status?: string } | undefined
  const version = x.version as { semver?: string } | undefined
  const caps = Array.isArray(x.capabilities) ? x.capabilities.length : 0
  return {
    role: String(x.role ?? '—'),
    name: String(x.name ?? '—'),
    status: (health?.status ?? 'idle'),
    version: version?.semver ?? '0.0.0',
    description: String(x.description ?? ''),
    capabilities: caps,
  }
}

/* ─── Workflows ───────────────────────────────────────────────── */

interface WorkflowRow {
  name: string; displayName: string; description: string;
  steps: Array<{ order: number; role: string; tool: string; description: string }>;
  estimatedCredits: number; estimatedLatencyMs: number;
}

const WF_ICONS = ['auto_awesome', 'bolt', 'troubleshoot', 'dataset_linked', 'hub', 'insights']

function Workflows({ rows }: { rows: WorkflowRow[] }) {
  const router = useRouter()
  const [running, setRunning] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [cmd, setCmd] = useState('')

  async function runWorkflow(name: string) {
    setRunning(name); setMessage(null)
    try {
      const res = await fetch('/api/a2a/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow: name, context: { source: 'dashboard_fleet_view' } }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Workflow dispatch failed.')
      setMessage(`${name} dispatched. Activity will update as agents report progress.`)
      router.refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Workflow dispatch failed.')
    } finally {
      setRunning(null)
    }
  }

  function submitCmd() {
    const q = cmd.trim().toLowerCase()
    if (!q) return
    const match = rows.find(w => w.name.toLowerCase().includes(q) || w.displayName.toLowerCase().includes(q))
    if (match) { void runWorkflow(match.name); setCmd('') }
    else setMessage(`No workflow matches “${cmd}”. Try one of: ${rows.map(w => w.name).join(', ')}`)
  }

  if (rows.length === 0) {
    return <div className="bg-surface-container-lowest hairline-border rounded-lg p-12 text-center font-body-main text-on-surface-variant">Loading workflows…</div>
  }

  const active = rows.slice(0, 3)

  return (
    <div className="space-y-section-gap pb-24">
      {message && (
        <div className="hairline-border bg-surface-container-lowest rounded-lg px-4 py-3 font-body-main text-on-surface-variant">{message}</div>
      )}

      {/* Active Workflows */}
      <section>
        <div className="flex items-baseline justify-between mb-stack-lg hairline-b pb-2">
          <h2 className="font-h1-editorial text-h1-editorial">Active Workflows</h2>
          <span className="font-label-mono text-label-mono text-on-surface-variant uppercase">{rows.length} Current Processes</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 hairline-border overflow-hidden">
          {active.map((w, i) => (
            <div key={w.name} className={`bg-surface-container-lowest p-stack-lg flex flex-col h-full group ${i < active.length - 1 ? 'hairline-r' : ''}`}>
              <span className="font-label-mono text-label-mono text-on-surface-variant mb-base uppercase">WF-{String(i + 1).padStart(3, '0')}</span>
              <h3 className="font-display-sm text-display-sm mb-stack-md group-hover:text-primary transition-colors">{w.displayName}</h3>
              <p className="font-body-main text-on-surface-variant mb-stack-lg flex-grow">{w.description}</p>
              <div className="flex items-center justify-between pt-stack-md border-t border-outline-variant/20">
                <button
                  onClick={() => void runWorkflow(w.name)}
                  disabled={running != null}
                  className="font-label-mono text-[10px] bg-secondary-container px-2 py-0.5 rounded text-on-secondary-container uppercase disabled:opacity-50"
                >{running === w.name ? 'Running…' : 'Run'}</button>
                <Icon name="arrow_forward" size={18} className="text-on-surface-variant group-hover:text-primary transition-colors" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Automation Pipelines */}
      <section>
        <div className="flex items-baseline justify-between mb-stack-lg hairline-b pb-2">
          <h2 className="font-h1-editorial text-h1-editorial">Automation Pipelines</h2>
          <span className="font-label-mono text-label-mono text-on-surface-variant uppercase flex items-center gap-2">
            <Icon name="add" size={14} /> {rows.length} Pipelines
          </span>
        </div>
        <div className="hairline-border bg-surface-container-lowest">
          <div className="grid grid-cols-12 px-stack-md py-3 hairline-b bg-surface-container-low font-label-mono text-[10px] text-on-surface-variant uppercase tracking-widest">
            <div className="col-span-5">Pipeline Identity</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2 text-right">Steps</div>
            <div className="col-span-1 text-right">Credits</div>
            <div className="col-span-2 text-right">Latency</div>
          </div>
          {rows.map((w, i) => (
            <button
              key={w.name}
              onClick={() => void runWorkflow(w.name)}
              disabled={running != null}
              className={`w-full grid grid-cols-12 px-stack-md h-12 items-center hover:bg-surface-container-high transition-colors group disabled:opacity-60 text-left ${i < rows.length - 1 ? 'hairline-b' : ''}`}
            >
              <div className="col-span-5 flex items-center gap-3 min-w-0">
                <Icon name={WF_ICONS[i % WF_ICONS.length]} size={18} className="text-primary shrink-0" />
                <span className="font-body-main font-medium truncate">{w.displayName}</span>
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-tertiary" />
                <span className="font-label-mono text-label-mono">{running === w.name ? 'Dispatching' : 'Ready'}</span>
              </div>
              <div className="col-span-2 text-right font-label-mono text-[12px]">{w.steps.length} steps</div>
              <div className="col-span-1 text-right font-label-mono text-[12px] text-on-surface-variant">~{w.estimatedCredits}</div>
              <div className="col-span-2 text-right font-label-mono text-[12px] text-on-surface-variant">~{Math.round(w.estimatedLatencyMs / 1000)}s</div>
            </button>
          ))}
        </div>
      </section>

      {/* Floating Command Input */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 md:left-[calc(50%+8rem)] w-full max-w-xl px-4 z-30">
        <form
          onSubmit={(e) => { e.preventDefault(); submitCmd() }}
          className="hairline-border bg-surface-container-lowest/90 backdrop-blur-xl px-6 py-4 flex items-center gap-4 group hover:border-primary/30 transition-all rounded-lg shadow-lg"
        >
          <Icon name="keyboard_command_key" className="text-primary" size={20} />
          <input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            className="bg-transparent border-none focus:ring-0 outline-none w-full font-body-large placeholder:text-outline-variant text-on-surface"
            placeholder="Trigger a workflow by name…"
          />
          <span className="font-label-mono text-[9px] border border-outline-variant px-1.5 py-0.5 rounded opacity-50 uppercase shrink-0">Enter</span>
        </form>
      </div>
    </div>
  )
}

/* ─── Activity ────────────────────────────────────────────────── */

interface AgentEvent {
  id: string
  agent_name: string
  event_type: string
  status: string
  title: string
  body: string | null
  created_at: string
}

function Activity() {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let stop = false
    async function poll() {
      try {
        const res = await fetch('/api/agents/events?limit=30')
        const d = await res.json()
        if (!stop && Array.isArray(d?.events)) setEvents(d.events)
      } catch { /* ignore */ }
      if (!stop) setLoaded(true)
    }
    void poll()
    const id = setInterval(poll, 8000)
    return () => { stop = true; clearInterval(id) }
  }, [])

  return (
    <div className="bg-surface-container-lowest hairline-border rounded-lg overflow-hidden">
      <div className="bg-surface-container-low/30 px-6 py-3 hairline-b flex items-center justify-between">
        <span className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant">Live event stream</span>
        <span className="flex items-center gap-2 font-label-mono text-[9px] uppercase text-on-surface-variant">
          <span className={`w-1.5 h-1.5 rounded-full ${loaded ? 'bg-tertiary animate-pulse' : 'bg-outline-variant'}`} /> {loaded ? 'connected' : 'connecting…'}
        </span>
      </div>
      {!loaded ? (
        <div className="p-12 text-center font-body-main text-on-surface-variant">Loading recent events…</div>
      ) : events.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="font-label-mono text-label-mono uppercase text-on-surface-variant mb-2">No events yet</p>
          <p className="font-body-main text-on-surface-variant max-w-sm mx-auto">
            The fleet hasn&rsquo;t recorded any events for your workspace yet. Trigger a workflow or wait for the signal agent&rsquo;s next poll cycle.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[rgba(26,24,22,0.07)] max-h-[480px] overflow-y-auto">
          {events.map((e) => (
            <div key={e.id} className="flex items-center px-6 py-3.5 gap-4 hover:bg-surface-container-low transition-colors">
              <span className="font-label-mono text-[10px] text-outline shrink-0 w-16">{formatTime(e.created_at)}</span>
              <span className="font-label-mono text-label-mono uppercase text-on-surface shrink-0 w-32 truncate">{e.agent_name}</span>
              <span className={`font-label-mono text-[9px] uppercase tracking-widest px-2 py-1 rounded shrink-0 ${statusPill(e.status)}`}>{e.status}</span>
              <span className="font-body-main text-on-surface-variant truncate flex-1">{e.title || e.event_type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
function pad(n: number) { return n.toString().padStart(2, '0') }
function statusPill(status: string): string {
  if (status === 'completed') return 'bg-tertiary/10 text-tertiary'
  if (status === 'failed' || status === 'blocked') return 'bg-error-container text-on-error-container'
  return 'bg-surface-container-high text-on-surface-variant'
}
