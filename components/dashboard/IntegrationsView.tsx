'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { UserProfile } from './types'
import type { SubscriptionTier } from '@/lib/lead-credits'
import { hasTeamFeatures } from '@/lib/plan-access'
import { useToast } from '@/components/Toast'

interface Props { profile: UserProfile }

interface ConnectedAccount {
  id: string; provider: string; email: string;
  display_name?: string | null; is_active: boolean; last_used_at?: string | null;
}

interface RemoteConnection {
  provider: 'telegram' | 'discord'
  providerUserId: string
  username: string | null
  enabled: boolean
  createdAt: string
}

interface RemoteControlState {
  configured: { telegram: boolean; discord: boolean }
  connections: RemoteConnection[]
}

/**
 * Integrations — every connection in one place, grouped by purpose.
 *
 *   01 Sending  — Gmail / Outlook OAuth (real)
 *   02 CRM      — bidirectional webhook sync
 *   03 Signals  — managed sources, no setup
 *   04 Ops      — Slack webhook + booking link via in-page modals
 *   05 Agents API — agent key issuance via mailto + docs link
 *
 * Every CTA either resolves to a working endpoint, opens an in-page
 * configuration modal, or is honestly marked "soon" — no dead links.
 */
export default function IntegrationsView({ profile }: Props) {
  const userTier = normalizeTier(profile.plan)
  const canUseTeamOps = hasTeamFeatures(userTier)
  const canUseCrm = hasTeamFeatures(userTier)
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [social, setSocial] = useState<{ managed: boolean; managed_reason?: string | null; error?: string | null; accounts: Array<{ id: string; partner: string; platform: string | null; display_name: string | null; is_active: boolean }> }>({ managed: false, accounts: [] })
  const [remoteControl, setRemoteControl] = useState<RemoteControlState>({ configured: { telegram: false, discord: false }, connections: [] })
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null)
  const [modal, setModal] = useState<null | 'slack' | 'calendly' | 'agentkey' | 'llm' | 'crm' | 'remote'>(null)
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)
  const toast = useToast()

  useEffect(() => {
    void fetch('/api/connected-accounts').then(r => r.json()).then(d => {
      if (Array.isArray(d?.accounts)) setAccounts(d.accounts)
    }).catch(() => {})
    void fetch('/api/integrations/social').then(r => r.json()).then(d => {
      if (typeof d?.error === 'string' && d.error) toast.error(`Social publishing could not load: ${d.error}`)
      setSocial({
        managed: !!d?.managed,
        managed_reason: typeof d?.managed_reason === 'string' ? d.managed_reason : null,
        error: null,
        accounts: Array.isArray(d?.accounts) ? d.accounts : [],
      })
    }).catch(() => {})
    void loadRemoteControl()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadRemoteControl() {
    const res = await fetch('/api/remote-control/connect')
    const data = await res.json().catch(() => ({})) as Partial<RemoteControlState>
    if (res.ok) {
      setRemoteControl({
        configured: {
          telegram: Boolean(data.configured?.telegram),
          discord: Boolean(data.configured?.discord),
        },
        connections: Array.isArray(data.connections) ? data.connections : [],
      })
    }
  }

  async function connectSocial(platform: 'linkedin' | 'x') {
    setConnectingPlatform(platform)
    try {
      const res = await fetch('/api/integrations/social/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform }) })
      const d = await res.json().catch(() => ({})) as { url?: string; error?: string }
      if (d.url) window.location.assign(d.url)
      else { setConnectingPlatform(null); toast.error(d.error ?? 'Could not start connection.') }
    } catch { setConnectingPlatform(null); toast.error('Could not start connection.') }
  }

  async function disconnectAccount(id: string) {
    setDisconnectingId(id)
    try {
      const res = await fetch('/api/connected-accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.ok) setAccounts(current => current.filter(account => account.id !== id))
      else toast.error('Could not disconnect account.')
    } finally {
      setDisconnectingId(null)
    }
  }

  const sending = accounts.filter(a => ['gmail', 'outlook', 'resend', 'ses'].includes(a.provider))

  return (
    <div className="space-y-12">
      <div>
        <p className="mono mb-2">Connections</p>
        <h2 className="text-[30px] leading-tight font-semibold tracking-[-0.02em] text-[var(--color-text-1)]">Integrations</h2>
        <p className="text-[13.5px] text-[var(--color-text-3)] mt-2 max-w-xl">
          Everything Bombsell talks to, in one place. Connect once &mdash; every agent uses what&rsquo;s here.
        </p>
      </div>

      {/* Sending */}
      <Group
        id="integrations-sending"
        label="01 · Sending"
        title="Outreach inboxes"
        body="Bombsell sends from your real inbox. Per-account warmup and daily limits enforced by the safety agent."
      >
        {sending.length > 0 && (
          <div className="card overflow-hidden mb-4">
            <div className="px-5">
              {sending.map((a) => (
                <div key={a.id} className="list-row grid-cols-[auto_1fr_auto_auto] gap-4">
                  <ProviderBadge name={a.provider} />
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium">{a.email}</div>
                    <div className="mono">{a.display_name ?? a.provider}</div>
                  </div>
                  <span className={`pill ${a.is_active ? 'pill-pos' : 'pill-warn'}`}>{a.is_active ? 'active' : 'paused'}</span>
                  <button
                    onClick={() => void disconnectAccount(a.id)}
                    disabled={disconnectingId === a.id}
                    className="btn-ghost h-7 px-3 text-[12px] disabled:opacity-50"
                  >
                    {disconnectingId === a.id ? 'Removing...' : 'Disconnect'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ConnectTile name="Gmail" href="/api/auth/google-mail" />
          <ConnectTile name="Outlook" href="/api/auth/microsoft-mail" />
          <ConnectTile name="Resend" disabled />
          <ConnectTile name="SES" disabled />
        </div>
      </Group>

      {/* CRM */}
      <Group
        id="integrations-crm"
        label="02 · CRM"
        title="Bidirectional sync"
        body="Team and custom workspaces can import CRM accounts into Bombsell and export signals, drafts, sends, replies, and bookings back to CRM."
      >
        <div className="card p-5 mb-4 grid md:grid-cols-[1fr_auto] items-center gap-4">
          <div>
            <div className="mono mb-1">{canUseCrm ? 'Team workspace' : 'Team/custom only'}</div>
            <div className="text-[13.5px] font-medium">Inbound CRM import + outbound CRM export</div>
            <div className="text-[12.5px] text-[var(--color-text-3)] mt-1">Use a CRM workflow webhook to push accounts into Bombsell, and an outbound webhook to write Bombsell outcomes back.</div>
          </div>
          {canUseCrm ? (
            <button onClick={() => setModal('crm')} className="btn-accent h-9 px-4 text-[13px]">Configure sync</button>
          ) : (
            <Link href="/pricing" className="btn-ghost h-9 px-4 text-[13px] inline-flex items-center">Upgrade</Link>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {['HubSpot', 'Salesforce', 'Pipedrive', 'Zoho'].map((name) => (
            <ConnectTile key={name} name={name} disabled={!canUseCrm} locked={!canUseCrm} requiredTier="Team" label={canUseCrm ? 'webhook' : undefined} onClickFn={canUseCrm ? () => setModal('crm') : undefined} />
          ))}
        </div>
      </Group>

      {/* Remote control */}
      <Group
        id="integrations-remote"
        label="03 · Remote control"
        title="Operate Bombsell from chat"
        body="Send text commands or voice notes from Telegram and Discord. Bombsell confirms risky actions before sending or dismissing."
      >
        <div className="card p-5 mb-4 grid md:grid-cols-[1fr_auto] items-center gap-4">
          <div>
            <div className="mono mb-1">Voice + text commands</div>
            <div className="text-[13.5px] font-medium">Telegram and Discord remote command center</div>
            <div className="text-[12.5px] text-[var(--color-text-3)] mt-1">
              Try “prepare draft for the top lead”, “unlock Acme”, or “confirm send outreach to Acme”.
            </div>
          </div>
          <button onClick={() => setModal('remote')} className="btn-accent h-9 px-4 text-[13px]">Configure remote</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ConnectTile
            name="Telegram"
            connected={remoteControl.connections.some(connection => connection.provider === 'telegram' && connection.enabled)}
            disabled={!remoteControl.configured.telegram}
            label={!remoteControl.configured.telegram ? 'not enabled' : undefined}
            onClickFn={remoteControl.configured.telegram ? () => setModal('remote') : undefined}
          />
          <ConnectTile
            name="Discord"
            connected={remoteControl.connections.some(connection => connection.provider === 'discord' && connection.enabled)}
            disabled={!remoteControl.configured.discord}
            label={!remoteControl.configured.discord ? 'not enabled' : undefined}
            onClickFn={remoteControl.configured.discord ? () => setModal('remote') : undefined}
          />
        </div>
      </Group>

      {/* Ops */}
      <Group
        id="integrations-ops"
        label="04 · Ops"
        title="Notifications &amp; booking"
        body="Slack pings on hot replies, booking links sent on positive intent, custom webhooks for any pipeline."
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ConnectTile
            name="Slack"
            connected={!!profile.slack_webhook_url}
            label={profile.slack_webhook_url ? 'configured' : undefined}
            disabled={!canUseTeamOps}
            locked={!canUseTeamOps}
            requiredTier="Team"
            href={!canUseTeamOps ? '/pricing' : undefined}
            onClickFn={canUseTeamOps ? () => setModal('slack') : undefined}
          />
          <ConnectTile
            name="Calendly"
            connected={!!profile.calendly_url}
            label={profile.calendly_url ? 'configured' : undefined}
            onClickFn={() => setModal('calendly')}
          />
          <ConnectTile name="Webhook" href="/api/docs/agents" label="see docs" />
        </div>
      </Group>

      {/* Content publishing */}
      <Group
        id="integrations-social"
        label="05 · Content publishing"
        title="Connect your social accounts"
        body="Connect LinkedIn and X — the publisher agent posts on your behalf. Nothing to install."
      >
        {social.managed ? (
          <div className="space-y-3">
            {social.accounts.filter(a => a.is_active).length > 0 && (
              <div className="card divide-y divide-[var(--color-line-1)]">
                {social.accounts.filter(a => a.is_active).map((a) => (
                  <div key={a.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <ProviderBadge name={a.platform === 'x' ? 'x' : 'linkedin'} />
                      <div className="text-[13px] text-[var(--color-text-1)]">{a.display_name ?? a.platform} <span className="mono ml-1">{a.platform}</span></div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="pill pill-pos">connected</span>
                      <button onClick={async () => { if (!a.platform) return; await fetch(`/api/integrations/social?partner=postforme&platform=${a.platform}`, { method: 'DELETE' }); window.location.reload() }} className="text-[12px] text-[var(--color-text-3)] hover:text-[var(--color-neg)]">Disconnect</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-2.5">
              <button onClick={() => void connectSocial('linkedin')} disabled={connectingPlatform != null} className="card p-4 text-left hover:border-[var(--color-text-1)] transition-colors disabled:opacity-50 flex items-center justify-between">
                <span className="text-[13.5px] font-medium">LinkedIn</span>
                <span className="text-[12px] text-[var(--color-accent)]">{connectingPlatform === 'linkedin' ? 'Connecting…' : 'Connect →'}</span>
              </button>
              <button onClick={() => void connectSocial('x')} disabled={connectingPlatform != null} className="card p-4 text-left hover:border-[var(--color-text-1)] transition-colors disabled:opacity-50 flex items-center justify-between">
                <span className="text-[13.5px] font-medium">X (Twitter)</span>
                <span className="text-[12px] text-[var(--color-accent)]">{connectingPlatform === 'x' ? 'Connecting…' : 'Connect →'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="card p-5 text-[13px] text-[var(--color-text-3)]">
            {social.managed_reason ?? 'Social publishing isn’t configured yet. Until it’s enabled, content posts stay as drafts in the Content tab — you can copy and publish them by hand.'}
          </div>
        )}
      </Group>

      {/* AI models */}
      <Group
        id="integrations-ai"
        label="06 · AI models"
        title="Bombsell Default LLM, or bring your own"
        body="Drafting and content writing run on the Bombsell Default LLM, billed via credits. Connect your own Claude or ChatGPT key to avoid LLM credit charge."
      >
        <div className="grid sm:grid-cols-2 gap-2.5">
          <ConnectTile name="Bombsell Default LLM" connected label="active" />
          <ConnectTile name="ChatGPT/Claude" onClickFn={() => setModal('llm')} />
        </div>
      </Group>

      {/* Agents API */}
      <Group
        id="integrations-agents-api"
        label="07 · Agents API"
        title="For developers and AI agents"
        body="Bombsell speaks the A2A protocol. Issue an agent key to let your AI agent call the fleet directly."
      >
        <div className="card p-5 grid md:grid-cols-2 gap-5">
          <div>
            <div className="mono mb-2">Endpoints</div>
            <ul className="text-[13px] space-y-1.5 font-mono text-[var(--color-text-2)]">
              <li>GET&nbsp;&nbsp;/api/a2a/agents</li>
              <li>POST /api/a2a/workflows</li>
              <li>POST /api/agents/:role/dispatch</li>
              <li>POST /api/agents/webhook</li>
            </ul>
          </div>
          <div>
            <div className="mono mb-2">Get started</div>
            <p className="text-[13px] text-[var(--color-text-3)] mb-3">Issue an agent key, then call the SDK or hit the REST endpoints directly.</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setModal('agentkey')} className="btn-accent h-8 px-4 text-[12.5px]">Issue agent key</button>
              <Link href="/api/docs/agents" className="btn-ghost h-8 px-4 text-[12.5px] inline-flex items-center">API docs →</Link>
            </div>
          </div>
        </div>
      </Group>

      {/* Modals */}
      {modal === 'slack' && (
        <SlackModal initial={profile.slack_webhook_url ?? ''} onClose={() => setModal(null)} />
      )}
      {modal === 'calendly' && (
        <CalendlyModal initial={profile.calendly_url ?? ''} onClose={() => setModal(null)} />
      )}
      {modal === 'agentkey' && <AgentKeyModal onClose={() => setModal(null)} />}
      {modal === 'llm' && <LlmModal onClose={() => setModal(null)} />}
      {modal === 'crm' && <CrmModal onClose={() => setModal(null)} />}
      {modal === 'remote' && <RemoteControlModal state={remoteControl} onRefresh={() => void loadRemoteControl()} onClose={() => setModal(null)} />}
    </div>
  )
}

function RemoteControlModal({
  state, onRefresh, onClose,
}: {
  state: RemoteControlState
  onRefresh: () => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [telegramUrl, setTelegramUrl] = useState<string | null>(null)
  const toast = useToast()

  async function connect(provider: 'telegram' | 'discord') {
    setBusy(provider)
    setTelegramUrl(null)
    try {
      const res = await fetch('/api/remote-control/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      const data = await res.json().catch(() => ({})) as { url?: string; error?: string }
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start remote-control connection.')
      if (provider === 'telegram') {
        setTelegramUrl(data.url)
        window.open(data.url, '_blank', 'noopener,noreferrer')
      } else {
        window.location.assign(data.url)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start remote-control connection.')
    } finally {
      setBusy(null)
    }
  }

  async function disconnect(provider: 'telegram' | 'discord') {
    setBusy(`disconnect-${provider}`)
    try {
      const res = await fetch('/api/remote-control/connect', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      if (!res.ok) throw new Error('Could not disconnect remote control.')
      onRefresh()
      toast.success(`${provider === 'telegram' ? 'Telegram' : 'Discord'} remote control disconnected.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not disconnect remote control.')
    } finally {
      setBusy(null)
    }
  }

  const telegram = state.connections.find(connection => connection.provider === 'telegram' && connection.enabled)
  const discord = state.connections.find(connection => connection.provider === 'discord' && connection.enabled)

  return (
    <Modal title="Remote control" onClose={onClose}>
      <p className="text-[13px] text-[var(--color-text-3)] mb-4">
        Connect your chat account once. After that, send Bombsell commands or voice notes from Telegram or Discord.
      </p>
      <div className="space-y-3">
        <RemoteProviderRow
          name="Telegram"
          configured={state.configured.telegram}
          connection={telegram}
          busy={busy === 'telegram' || busy === 'disconnect-telegram'}
          onConnect={() => void connect('telegram')}
          onDisconnect={() => void disconnect('telegram')}
        />
        <RemoteProviderRow
          name="Discord"
          configured={state.configured.discord}
          connection={discord}
          busy={busy === 'discord' || busy === 'disconnect-discord'}
          onConnect={() => void connect('discord')}
          onDisconnect={() => void disconnect('discord')}
        />
      </div>
      {telegramUrl && (
        <div className="mt-4 rounded-xl border border-[var(--color-line-2)] bg-[var(--color-ink-2)] p-3">
          <div className="mono mb-1">Telegram link</div>
          <a href={telegramUrl} target="_blank" rel="noreferrer" className="text-[13px] text-primary hover:underline">Open Bombsell bot →</a>
        </div>
      )}
      <div className="mt-5 rounded-xl border border-[var(--color-line-2)] bg-[var(--color-ink-2)] p-3">
        <div className="mono mb-2">Examples</div>
        <ul className="text-[12.5px] text-[var(--color-text-2)] space-y-1">
          <li>prepare draft for the top lead</li>
          <li>unlock Acme Robotics</li>
          <li>mark Acme booked</li>
          <li>confirm send outreach to Acme Robotics</li>
        </ul>
      </div>
      <div className="mt-5 flex items-center justify-end gap-2">
        <button onClick={() => { onRefresh(); onClose() }} className="btn-accent h-9 px-4 text-[12.5px]">Done</button>
      </div>
    </Modal>
  )
}

function RemoteProviderRow({
  name, configured, connection, busy, onConnect, onDisconnect,
}: {
  name: 'Telegram' | 'Discord'
  configured: boolean
  connection?: RemoteConnection
  busy: boolean
  onConnect: () => void
  onDisconnect: () => void
}) {
  return (
    <div className="rounded-xl border border-[var(--color-line-2)] bg-[var(--color-ink-0)] p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium">{name}</div>
        <div className="text-[12px] text-[var(--color-text-3)] truncate">
          {!configured ? 'Not enabled for this deployment' : connection ? connection.username || connection.providerUserId : 'Not connected'}
        </div>
      </div>
      {connection ? (
        <button onClick={onDisconnect} disabled={busy} className="btn-ghost h-8 px-3 text-[12px] disabled:opacity-50">
          {busy ? 'Working...' : 'Disconnect'}
        </button>
      ) : (
        <button onClick={onConnect} disabled={busy || !configured} className="btn-accent h-8 px-3 text-[12px] disabled:opacity-50">
          {busy ? 'Opening...' : 'Connect'}
        </button>
      )}
    </div>
  )
}

function CrmModal({ onClose }: { onClose: () => void }) {
  const [provider, setProvider] = useState('webhook')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [providers, setProviders] = useState<Array<{ id: string; label: string; exportDescription: string; importDescription: string }>>([])
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    void fetch('/api/settings/crm-sync').then(async (res) => {
      const data = await res.json().catch(() => ({})) as {
        provider?: string; webhook_url?: string; enabled?: boolean; import_url?: string;
        providers?: Array<{ id: string; label: string; exportDescription: string; importDescription: string }>
        error?: string
      }
      if (!res.ok) throw new Error(data.error || 'Could not load CRM sync.')
      setProvider(data.provider ?? 'webhook')
      setWebhookUrl(data.webhook_url ?? '')
      setEnabled(Boolean(data.enabled))
      setImportUrl(data.import_url ?? '')
      setProviders(Array.isArray(data.providers) ? data.providers : [])
    }).catch((error) => toast.error(error instanceof Error ? error.message : 'Could not load CRM sync.'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    setBusy(true)
    const res = await fetch('/api/settings/crm-sync', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, webhook_url: webhookUrl, enabled: true }),
    })
    const data = await res.json().catch(() => ({})) as { import_url?: string; error?: string }
    setBusy(false)
    if (!res.ok) { toast.error(data.error || 'Could not save CRM sync.'); return }
    setEnabled(true)
    setImportUrl(data.import_url ?? importUrl)
    toast.success('CRM sync saved.')
  }

  const preset = providers.find(p => p.id === provider)

  return (
    <Modal title="Bidirectional CRM sync" onClose={onClose}>
      <p className="text-[13px] text-[var(--color-text-3)] mb-4">Configure both directions: CRM → Bombsell import webhook, and Bombsell → CRM outcome export webhook.</p>
      <label className="mono block mb-1">CRM</label>
      <select value={provider} onChange={(e) => setProvider(e.target.value)}
        className="w-full h-10 px-3 mb-3 bg-[var(--color-ink-1)] border border-[var(--color-line-2)] rounded-lg text-[13px] outline-none focus:border-[var(--color-text-1)]">
        {(providers.length ? providers : [{ id: 'webhook', label: 'Generic Webhook', exportDescription: '', importDescription: '' }]).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <label className="mono block mb-1">Outbound CRM webhook</label>
      <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://your-crm-or-automation-webhook"
        className="w-full h-10 px-3 mb-3 bg-[var(--color-ink-1)] border border-[var(--color-line-2)] rounded-lg text-[13px] outline-none focus:border-[var(--color-text-1)]" />
      {importUrl && (
        <div className="rounded-xl border border-[var(--color-line-2)] bg-[var(--color-ink-2)] p-3">
          <div className="mono mb-2">Inbound import URL</div>
          <code className="break-all text-[12px] text-[var(--color-text-1)]">{importUrl}</code>
        </div>
      )}
      {preset && <p className="text-[12px] text-[var(--color-text-3)] mt-3">{preset.importDescription} {preset.exportDescription}</p>}
      <div className="mt-5 flex items-center justify-end gap-2">
        <button onClick={onClose} className="btn-ghost h-9 px-4 text-[12.5px]">Close</button>
        <button onClick={() => void save()} disabled={busy || !webhookUrl.trim()} className="btn-accent h-9 px-4 text-[12.5px] disabled:opacity-50">{busy ? 'Saving...' : enabled ? 'Save sync' : 'Enable sync'}</button>
      </div>
    </Modal>
  )
}

function LlmModal({ onClose }: { onClose: () => void }) {
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  async function save() {
    if (!apiKey) { toast.error('API key required.'); return }
    setBusy(true)
    const res = await fetch('/api/integrations/llm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, api_key: apiKey, model: model || undefined }),
    })
    if (!res.ok) { const b = await res.json().catch(() => ({})); toast.error(b?.error || 'Could not save.'); setBusy(false); return }
    onClose(); window.location.reload()
  }
  return (
    <Modal title="Connect your LLM" onClose={onClose}>
      <p className="text-[13px] text-[var(--color-text-3)] mb-4">Drafting & content writing will run on your key — no LLM credit charge. Remove it any time to fall back to the Bombsell Default LLM.</p>
      <label className="mono block mb-1">Provider</label>
      <select value={provider} onChange={(e) => setProvider(e.target.value as 'anthropic' | 'openai')}
        className="w-full h-10 px-3 mb-3 bg-[var(--color-ink-1)] border border-[var(--color-line-2)] rounded-lg text-[13px] outline-none focus:border-[var(--color-text-1)]">
        <option value="anthropic">Claude (Anthropic)</option>
        <option value="openai">ChatGPT (OpenAI)</option>
      </select>
      <label className="mono block mb-1">API key</label>
      <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
        className="w-full h-10 px-3 mb-3 bg-[var(--color-ink-1)] border border-[var(--color-line-2)] rounded-lg text-[13px] outline-none focus:border-[var(--color-text-1)]" />
      <label className="mono block mb-1">Model <span className="text-[var(--color-text-3)]">(optional)</span></label>
      <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o'}
        className="w-full h-10 px-3 bg-[var(--color-ink-1)] border border-[var(--color-line-2)] rounded-lg text-[13px] outline-none focus:border-[var(--color-text-1)]" />
      <div className="mt-5 flex items-center justify-end gap-2">
        <button onClick={onClose} className="btn-ghost h-9 px-4 text-[12.5px]">Cancel</button>
        <button onClick={() => void save()} disabled={busy} className="btn-accent h-9 px-4 text-[12.5px] disabled:opacity-50">{busy ? 'Saving…' : 'Connect'}</button>
      </div>
    </Modal>
  )
}

/* ─── Modals ──────────────────────────────────────────────────── */

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <div className="absolute inset-0 bg-[var(--color-text-1)]/40" onClick={onClose} />
      <div className="relative card p-6 w-full max-w-md">
        <div className="flex items-baseline justify-between mb-5">
          <h3 className="text-[16px] font-medium tracking-tight">{title}</h3>
          <button onClick={onClose} className="text-[var(--color-text-3)] hover:text-[var(--color-text-1)] text-[18px] leading-none" aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function SlackModal({ initial, onClose }: { initial: string; onClose: () => void }) {
  const [url, setUrl] = useState(initial)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  async function save() {
    setBusy(true)
    const res = await fetch('/api/settings/slack-webhook', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slack_webhook_url: url, slack_min_score: 7 }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error || 'Could not save. Check the URL and try again.')
      setBusy(false); return
    }
    onClose(); window.location.reload()
  }
  return (
    <Modal title="Slack notifications" onClose={onClose}>
      <p className="text-[13px] text-[var(--color-text-3)] mb-4">Paste an incoming-webhook URL. Bombsell will ping you when a hot reply lands.</p>
      <input
        value={url} onChange={(e) => setUrl(e.target.value)}
        placeholder="https://hooks.slack.com/services/..."
        className="w-full h-10 px-3 bg-[var(--color-ink-1)] border border-[var(--color-line-2)] rounded-lg text-[13px] outline-none focus:border-[var(--color-text-1)]"
      />
      <div className="mt-5 flex items-center justify-end gap-2">
        <button onClick={onClose} className="btn-ghost h-9 px-4 text-[12.5px]">Cancel</button>
        <button onClick={save} disabled={busy} className="btn-accent h-9 px-4 text-[12.5px] disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  )
}

function CalendlyModal({ initial, onClose }: { initial: string; onClose: () => void }) {
  const [url, setUrl] = useState(initial)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  async function save() {
    setBusy(true)
    const res = await fetch('/api/profile/field', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendly_url: url }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error || 'Could not save. Check the URL and try again.')
      setBusy(false); return
    }
    onClose(); window.location.reload()
  }
  return (
    <Modal title="Booking link" onClose={onClose}>
      <p className="text-[13px] text-[var(--color-text-3)] mb-4">Used when a reply asks for a meeting. Cal.com works too.</p>
      <input
        value={url} onChange={(e) => setUrl(e.target.value)}
        placeholder="https://cal.com/you  ·  https://calendly.com/you"
        className="w-full h-10 px-3 bg-[var(--color-ink-1)] border border-[var(--color-line-2)] rounded-lg text-[13px] outline-none focus:border-[var(--color-text-1)]"
      />
      <div className="mt-5 flex items-center justify-end gap-2">
        <button onClick={onClose} className="btn-ghost h-9 px-4 text-[12.5px]">Cancel</button>
        <button onClick={save} disabled={busy} className="btn-accent h-9 px-4 text-[12.5px] disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  )
}

function AgentKeyModal({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [apiKey, setApiKey] = useState<string | null>(null)
  const toast = useToast()

  async function issueKey() {
    setBusy(true)
    try {
      const agentsRes = await fetch('/api/agents')
      const agentsJson = await agentsRes.json().catch(() => ({})) as { agents?: Array<{ id: string }> }
      let agentId = agentsJson.agents?.[0]?.id

      if (!agentId) {
        const createRes = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Workspace Agent',
            description: 'Default external agent identity for Bombsell A2A access.',
            provider: 'custom',
          }),
        })
        const createJson = await createRes.json().catch(() => ({})) as { agent?: { id: string }; error?: string }
        if (!createRes.ok || !createJson.agent?.id) throw new Error(createJson.error || 'Could not create agent identity.')
        agentId = createJson.agent.id
      }

      const keyRes = await fetch('/api/agents/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          name: 'Dashboard key',
          scopes: ['read:signals', 'read:accounts', 'write:workflows'],
        }),
      })
      const keyJson = await keyRes.json().catch(() => ({})) as { api_key?: string; error?: string }
      if (!keyRes.ok || !keyJson.api_key) throw new Error(keyJson.error || 'Could not issue agent key.')
      setApiKey(keyJson.api_key)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not issue agent key.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Issue agent key" onClose={onClose}>
      <p className="text-[13px] text-[var(--color-text-3)] mb-4">
        Agent keys let your AI agents call Bombsell&rsquo;s A2A API directly. Store the key now; it is only shown once.
      </p>
      <div className="codeblock text-[11.5px]">
{`curl https://bombsell.com/api/a2a/agents \\
  -H "Authorization: Bearer ${apiKey ?? 'bsk_agt_...'}"`}
      </div>
      {apiKey && (
        <div className="mt-4 rounded-xl border border-[var(--color-line-2)] bg-[var(--color-ink-2)] p-3">
          <div className="mono mb-2">New key</div>
          <code className="break-all text-[12px] text-[var(--color-text-1)]">{apiKey}</code>
        </div>
      )}
      <div className="mt-5 flex items-center justify-end gap-2">
        <Link href="/api/docs/agents" className="btn-ghost h-9 px-4 text-[12.5px] inline-flex items-center">API docs →</Link>
        <button onClick={() => void issueKey()} disabled={busy} className="btn-accent h-9 px-4 text-[12.5px] disabled:opacity-50">
          {busy ? 'Issuing...' : 'Issue key'}
        </button>
      </div>
    </Modal>
  )
}

/* ─── Primitives ──────────────────────────────────────────────── */

function Group({
  id, label, title, body, children,
}: { id?: string; label: string; title: string; body: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-[var(--color-line-1)] pt-10">
      <div className="grid md:grid-cols-[260px_1fr] gap-10">
        <div>
          <div className="mono mb-2">{label}</div>
          <h3 className="text-[18px] leading-tight font-semibold text-[var(--color-text-1)]" dangerouslySetInnerHTML={{ __html: title }} />
          <p className="text-[13px] text-[var(--color-text-3)] mt-2 leading-relaxed">{body}</p>
        </div>
        <div>{children}</div>
      </div>
    </section>
  )
}

function ConnectTile({
  name, href, connected, disabled, locked, label, requiredTier, onClickFn,
}: {
  name: string; href?: string; connected?: boolean; disabled?: boolean; locked?: boolean; label?: string; requiredTier?: string;
  onClickFn?: () => void;
}) {
  const status = connected ? (
    <span className="pill pill-pos">{label ?? 'connected'}</span>
  ) : locked ? (
    <span className="pill">{requiredTier ?? 'Upgrade'}</span>
  ) : disabled ? (
    <span className="pill">{label ?? 'soon'}</span>
  ) : (
    <span className="text-[12px] text-[var(--color-accent)]">{label ?? 'Connect →'}</span>
  )

  const inner = (
    <div className={`card px-4 py-3.5 flex items-center justify-between transition-colors ${disabled ? 'opacity-60' : 'hover:border-[var(--color-line-3)]'}`}>
      <div className="flex items-center gap-2.5">
        <ProviderBadge name={name.toLowerCase()} />
        <span className="text-[13px] font-medium">{name}</span>
      </div>
      {status}
    </div>
  )

  if (disabled && !href) return <div>{inner}</div>
  if (onClickFn) return <button onClick={onClickFn} className="text-left w-full">{inner}</button>
  if (href) return <a href={href}>{inner}</a>
  return <div>{inner}</div>
}

function normalizeTier(value: string | null | undefined): SubscriptionTier {
  return value === 'launch' || value === 'team' || value === 'growth' || value === 'scale' || value === 'enterprise' ? value : 'free'
}

function ProviderBadge({ name }: { name: string }) {
  const letter = (name || '?').slice(0, 1).toUpperCase()
  return (
    <span className="w-7 h-7 rounded-md bg-[var(--color-ink-2)] text-[var(--color-text-2)] inline-flex items-center justify-center text-[12px] font-semibold">
      {letter}
    </span>
  )
}
