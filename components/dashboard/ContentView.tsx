'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { UserProfile } from './types'
import { useToast } from '@/components/Toast'

interface Props { profile: UserProfile }

export interface ContentIdea { id: string; source: string | null; platform: string | null; angle: string; hook: string | null; rationale: string | null; score: number; status: string; created_at: string }
interface Post { id: string; idea_id: string | null; platform: string; status: string; hook: string | null; body: string; thread: string[] | null; eval_score: number | null; eval_failed: string[]; scheduled_at: string | null; published_at: string | null; partner: string | null; metrics: Record<string, number> | null; metrics_fetched_at: string | null; error_message: string | null; created_at: string; updated_at: string }

type Tab = 'ideas' | 'composer' | 'calendar' | 'performance'
export type ContentVoiceCommand = { nonce: number; tab?: Tab; focusIdeaId?: string | null; focusPostId?: string | null; reload?: boolean }

interface SocialAccount {
  id: string
  partner: string
  platform: string | null
  display_name: string | null
  is_active: boolean
}

const C = '/api/content'

export default function ContentView({
  profile,
  voiceCommand,
  onVisibleContextChange,
}: Props & {
  voiceCommand?: ContentVoiceCommand | null
  onVisibleContextChange?: (context: { ideas: ContentIdea[]; drafts: Post[] }) => void
}) {
  const [tab, setTab] = useState<Tab>('ideas')
  const [ideas, setIdeas] = useState<ContentIdea[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useToast()

  const connectedPlatforms = useMemo(() => {
    const set = new Set<string>()
    for (const a of socialAccounts) {
      if (a.is_active && a.platform) set.add(a.platform)
    }
    return set
  }, [socialAccounts])

  const loadIdeas = useCallback(async () => {
    const d = await fetch(`${C}?resource=ideas`).then((r) => r.json()).catch(() => ({}))
    setIdeas(Array.isArray(d?.ideas) ? d.ideas : [])
  }, [])
  const loadPosts = useCallback(async () => {
    const d = await fetch(`${C}?resource=posts`).then((r) => r.json()).catch(() => ({}))
    setPosts(Array.isArray(d?.posts) ? d.posts : [])
  }, [])

  useEffect(() => {
    void loadIdeas(); void loadPosts()
    void fetch('/api/integrations/social')
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d?.accounts)) setSocialAccounts(d.accounts as SocialAccount[])
      })
      .catch(() => {})
  }, [loadIdeas, loadPosts])

  useEffect(() => {
    if (!voiceCommand) return
    if (voiceCommand.tab) setTab(voiceCommand.tab)
    if (voiceCommand.reload) void Promise.all([loadIdeas(), loadPosts()])
    const targetId = voiceCommand.focusIdeaId
      ? `content-idea-${voiceCommand.focusIdeaId}`
      : voiceCommand.focusPostId
        ? `content-post-${voiceCommand.focusPostId}`
        : null
    if (!targetId) return
    const handle = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 120)
    return () => window.clearTimeout(handle)
  }, [loadIdeas, loadPosts, voiceCommand])

  async function act(action: string, payload: Record<string, unknown>, label: string, successMsg?: string) {
    setBusy(label)
    try {
      const res = await fetch(C, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) })
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; result?: unknown }
      if (!res.ok || d.ok === false) throw new Error(d.error || 'Action failed')
      await Promise.all([loadIdeas(), loadPosts()])
      if (successMsg) toast.success(successMsg)
      return d
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed'); return null
    } finally { setBusy(null) }
  }

  async function patchPost(postId: string, patch: Record<string, unknown>) {
    const res = await fetch(C, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId, ...patch }) })
    if (res.ok) {
      await loadPosts()
      toast.success('Draft saved.')
    } else {
      toast.error('Failed to save draft.')
    }
  }

  const proposed = ideas.filter((i) => i.status === 'proposed' || i.status === 'approved')
  const drafts = posts.filter((p) => p.status === 'draft' || p.status === 'edited')
  const scheduled = posts.filter((p) => p.status === 'scheduled')
  const published = posts.filter((p) => p.status === 'published')

  useEffect(() => {
    onVisibleContextChange?.({ ideas: proposed, drafts })
  }, [drafts, onVisibleContextChange, proposed])

  return (
    <div className="space-y-section-gap">
      <div className="flex items-start justify-between gap-stack-lg flex-wrap">
        <div>
          <p className="font-label-mono text-label-mono uppercase text-on-surface-variant mb-3">Publishing · {profile.client_name || profile.company_name}</p>
          <h2 className="font-h1-editorial text-display-sm text-on-surface">
            The <span className="italic text-primary">content</span> engine.
          </h2>
          <p className="font-body-main text-on-surface-variant max-w-2xl mt-stack-md">
            Idea → write → edit → schedule → publish → learn. LinkedIn & X posts, tuned by what performs.
          </p>
        </div>
        <div className="flex items-center gap-1 hairline-border rounded-full p-1">
          {(['ideas', 'composer', 'calendar', 'performance'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`h-8 px-4 rounded-full font-label-mono text-label-mono uppercase tracking-wider transition-colors ${tab === t ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant hover:text-on-surface'}`}>
              {t}{t === 'ideas' && proposed.length ? ` · ${proposed.length}` : ''}{t === 'composer' && drafts.length ? ` · ${drafts.length}` : ''}
            </button>
          ))}
        </div>
      </div>

      {tab === 'ideas' && (
        <section className="space-y-stack-lg">
          <div className="flex items-center gap-3">
            <button onClick={() => void act('generate_ideas', { count: 5 }, 'gen', 'Ideas generated.')} disabled={busy === 'gen'}
              className="bg-primary text-on-primary px-stack-md py-stack-sm font-label-mono text-label-mono uppercase tracking-widest hover:bg-primary-container transition-colors disabled:opacity-60">
              {busy === 'gen' ? 'Generating…' : 'Generate ideas'}
            </button>
            <span className="font-label-mono text-[10px] uppercase text-on-surface-variant">{proposed.length} in backlog</span>
          </div>
          {proposed.length === 0 ? (
            <Empty text="No ideas yet. Generate a batch from your recent signals & positioning." />
          ) : (
            <div className="space-y-px bg-outline-variant/30 hairline-border">
              {proposed.map((i) => (
                <div key={i.id} id={`content-idea-${i.id}`} className="scroll-mt-24 bg-surface-container-lowest p-stack-md">
                  <div className="flex items-start justify-between gap-stack-md">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-label-mono text-[9px] uppercase tracking-widest text-primary">{i.platform ?? 'linkedin'}</span>
                        <span className="font-label-mono text-[9px] uppercase text-on-surface-variant">score {Math.round(i.score)}</span>
                        {i.status === 'approved' && <span className="font-label-mono text-[9px] uppercase text-tertiary">approved</span>}
                      </div>
                      <p className="font-body-main text-on-surface">{i.angle}</p>
                      {i.hook && <p className="font-body-main text-on-surface-variant mt-1 text-[13px]">Hook: {i.hook}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {i.status !== 'approved' && <button onClick={() => void act('set_idea_status', { ideaId: i.id, status: 'approved' }, `appr-${i.id}`, 'Idea approved.')} className="font-label-mono text-[10px] uppercase border border-outline-variant px-2 py-1 rounded hover:bg-surface-container">Approve</button>}
                      <button onClick={() => void act('set_idea_status', { ideaId: i.id, status: 'rejected' }, `rej-${i.id}`, 'Idea rejected.')} className="font-label-mono text-[10px] uppercase text-on-surface-variant hover:text-error">Reject</button>
                      <button onClick={async () => { const d = await act('write', { ideaId: i.id }, `wr-${i.id}`, 'Draft created.'); if (d) setTab('composer') }} disabled={busy === `wr-${i.id}`}
                        className="font-label-mono text-[10px] uppercase bg-secondary-container text-on-secondary-container px-2 py-1 rounded disabled:opacity-60">{busy === `wr-${i.id}` ? 'Drafting…' : 'Draft post'}</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'composer' && (
        <section className="space-y-stack-lg">
          {drafts.length === 0 ? <Empty text="No drafts. Approve an idea and hit 'Draft post'." /> : drafts.map((p) => (
            <PostEditor key={p.id} post={p} busy={busy} connectedPlatforms={connectedPlatforms}
              onSave={(hook, body) => void patchPost(p.id, { hook, body })}
              onEdit={() => void act('edit', { postId: p.id }, `ed-${p.id}`, 'Draft edited.')}
              onSchedule={(when) => void act('schedule', { postId: p.id, scheduledAt: when }, `sc-${p.id}`, 'Post scheduled.')}
              onPublish={() => void act('publish', { postId: p.id }, `pub-${p.id}`, 'Post published.')}
              onDelete={() => void act('delete_post', { postId: p.id }, `del-${p.id}`, 'Draft rejected.')} />
          ))}
        </section>
      )}

      {tab === 'calendar' && (
        <section className="space-y-stack-lg">
          <Group title={`Scheduled · ${scheduled.length}`}>
            {scheduled.length === 0 ? <Empty text="Nothing scheduled." /> : scheduled.map((p) => <Row key={p.id} p={p} when={p.scheduled_at} />)}
          </Group>
          <Group title={`Published · ${published.length}`}>
            {published.length === 0 ? <Empty text="Nothing published yet." /> : published.map((p) => <Row key={p.id} p={p} when={p.published_at} />)}
          </Group>
        </section>
      )}

      {tab === 'performance' && (
        <section className="space-y-stack-lg">
          <button onClick={() => void act('metrics', { limit: 25 }, 'metrics', 'Metrics refreshed.')} disabled={busy === 'metrics'}
            className="font-label-mono text-[10px] uppercase border border-outline-variant px-3 py-1.5 rounded hover:bg-surface-container disabled:opacity-60">
            {busy === 'metrics' ? 'Refreshing…' : 'Refresh metrics'}
          </button>
          {published.length === 0 ? <Empty text="No published posts to measure yet." /> : (
            <div className="hairline-border bg-surface-container-lowest">
              <div className="grid grid-cols-12 px-stack-md py-3 hairline-b bg-surface-container-low font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                <div className="col-span-5">Post</div><div className="col-span-1 text-right">Impr.</div><div className="col-span-1 text-right">Likes</div><div className="col-span-1 text-right">Comm.</div><div className="col-span-1 text-right">Reposts</div><div className="col-span-3 text-right">Published</div>
              </div>
              {published.map((p) => {
                const m = p.metrics ?? {}
                return (
                  <div key={p.id} className="grid grid-cols-12 px-stack-md py-3 items-center hairline-b last:border-0">
                    <div className="col-span-5 min-w-0"><p className="font-body-main truncate text-on-surface">{p.hook || p.body.slice(0, 80)}</p><span className="font-label-mono text-[9px] uppercase text-on-surface-variant">{p.platform}</span></div>
                    <div className="col-span-1 text-right font-label-mono text-[12px]">{m.impressions ?? '—'}</div>
                    <div className="col-span-1 text-right font-label-mono text-[12px]">{m.likes ?? '—'}</div>
                    <div className="col-span-1 text-right font-label-mono text-[12px]">{m.comments ?? '—'}</div>
                    <div className="col-span-1 text-right font-label-mono text-[12px]">{m.reposts ?? '—'}</div>
                    <div className="col-span-3 text-right font-label-mono text-[11px] text-on-surface-variant">{fmt(p.published_at)}</div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function PostEditor({ post, busy, connectedPlatforms, onSave, onEdit, onSchedule, onPublish, onDelete }: {
  post: Post; busy: string | null; connectedPlatforms: Set<string>
  onSave: (hook: string, body: string) => void
  onEdit: () => void; onSchedule: (when: string) => void; onPublish: () => void; onDelete: () => void
}) {
  const [hook, setHook] = useState(post.hook ?? '')
  const [body, setBody] = useState(post.body)
  const [when, setWhen] = useState('')
  const toast = useToast()
  const platformConnected = connectedPlatforms.has(post.platform)
  function handleSchedule() {
    if (!when) return
    if (!platformConnected) {
      toast.error(`Connect your ${post.platform} account in Integrations → Content publishing before scheduling.`)
      return
    }
    onSchedule(new Date(when).toISOString())
  }
  function handlePublish() {
    if (!platformConnected) {
      toast.error(`Connect your ${post.platform} account in Integrations → Content publishing before publishing.`)
      return
    }
    onPublish()
  }
  return (
    <div id={`content-post-${post.id}`} className="scroll-mt-24 hairline-border bg-surface-container-lowest p-stack-md space-y-stack-md">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-label-mono text-[9px] uppercase tracking-widest text-primary">{post.platform}</span>
          <span className="font-label-mono text-[9px] uppercase text-on-surface-variant">{post.status}</span>
          {typeof post.eval_score === 'number' && <span className={`font-label-mono text-[9px] uppercase px-1.5 py-0.5 rounded ${post.eval_score >= 80 ? 'bg-tertiary/10 text-tertiary' : 'bg-surface-container-high text-on-surface-variant'}`}>eval {post.eval_score}</span>}
        </div>
        {post.eval_failed?.length ? <span className="font-label-mono text-[9px] uppercase text-error">{post.eval_failed.join(' · ')}</span> : null}
      </div>
      <input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="Hook (first line)"
        className="w-full bg-transparent border-b border-outline-variant py-1 font-body-large text-on-surface placeholder:text-outline-variant outline-none" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6}
        className="w-full bg-surface border border-outline-variant/40 rounded p-3 font-body-main text-on-surface outline-none resize-y" />
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => onSave(hook, body)} className="font-label-mono text-[10px] uppercase border border-outline-variant px-3 py-1.5 rounded hover:bg-surface-container">Save</button>
        <button onClick={onEdit} disabled={busy === `ed-${post.id}`} className="font-label-mono text-[10px] uppercase border border-outline-variant px-3 py-1.5 rounded hover:bg-surface-container disabled:opacity-60">{busy === `ed-${post.id}` ? 'Editing…' : 'Run editor'}</button>
        <span className="h-4 w-px bg-outline-variant mx-1" />
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="font-label-mono text-[11px] bg-surface border border-outline-variant/40 rounded px-2 py-1" />
        <button onClick={handleSchedule} disabled={!when || busy === `sc-${post.id}`} className="font-label-mono text-[10px] uppercase border border-outline-variant px-3 py-1.5 rounded hover:bg-surface-container disabled:opacity-40">{busy === `sc-${post.id}` ? 'Scheduling…' : 'Schedule'}</button>
        <button onClick={handlePublish} disabled={busy === `pub-${post.id}`} className="font-label-mono text-[10px] uppercase bg-primary text-on-primary px-3 py-1.5 rounded hover:bg-primary-container disabled:opacity-60">{busy === `pub-${post.id}` ? 'Publishing…' : 'Publish now'}</button>
        <span className="h-4 w-px bg-outline-variant mx-1" />
        <button onClick={onDelete} disabled={busy === `del-${post.id}`} className="font-label-mono text-[10px] uppercase text-on-surface-variant hover:text-error disabled:opacity-60">{busy === `del-${post.id}` ? 'Deleting…' : 'Reject'}</button>
      </div>
      {post.error_message && <p className="font-label-mono text-[10px] text-error">{post.error_message}</p>}
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h3 className="font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant mb-3 hairline-b pb-2">{title}</h3><div className="space-y-px bg-outline-variant/30 hairline-border">{children}</div></div>
}
function Row({ p, when }: { p: Post; when: string | null }) {
  return (
    <div className="bg-surface-container-lowest px-stack-md py-3 flex items-center gap-stack-md">
      <span className="font-label-mono text-[9px] uppercase tracking-widest text-primary w-16 shrink-0">{p.platform}</span>
      <p className="font-body-main text-on-surface truncate flex-1">{p.hook || p.body.slice(0, 100)}</p>
      <span className="font-label-mono text-[11px] text-on-surface-variant shrink-0">{fmt(when)}</span>
    </div>
  )
}
function Empty({ text }: { text: string }) {
  return <div className="bg-surface-container-lowest hairline-border rounded-lg px-6 py-12 text-center font-body-main text-on-surface-variant">{text}</div>
}
function fmt(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } catch { return '—' }
}
