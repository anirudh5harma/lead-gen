'use client'

import { useState, useEffect, useCallback } from 'react'
import type { SequenceTemplateRow } from './types'

export default function SequencesView() {
  const [templates, setTemplates] = useState<SequenceTemplateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('Default')
  const [instructions, setInstructions] = useState('')
  const [followupInstructions, setFollowupInstructions] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sequence-templates')
      const data = await res.json() as { templates?: SequenceTemplateRow[] }
      setTemplates(data.templates ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function saveTemplate() {
    setSaving(true)
    try {
      const res = await fetch('/api/sequence-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, custom_instructions: instructions, followup_custom_instructions: followupInstructions, is_default: true }),
      })
      if (res.ok) { setInstructions(''); setFollowupInstructions(''); await load() }
    } finally { setSaving(false) }
  }

  async function makeDefault(id: string) {
    setSaving(true)
    try {
      await fetch('/api/sequence-templates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, is_default: true }) })
      await load()
    } finally { setSaving(false) }
  }

  return (
    <div className="w-full space-y-5">
      <div className="card overflow-hidden shadow-sm">
        <div className="px-5 py-4 bg-[var(--color-ink-2)]/30 border-b border-[var(--color-line-1)]">
          <h2 className="text-lg font-bold text-[var(--color-text-1)]">Sequence Templates</h2>
          <p className="text-xs text-[var(--color-text-4)] mt-0.5">Reusable guidance injected into draft generation for initial outreach and follow-ups.</p>
        </div>
        <div className="px-5 py-4 space-y-3">
          <input value={name} onChange={e => setName(e.target.value)} className="w-full h-9 px-3 rounded-lg bg-[var(--color-ink-2)] border border-[var(--color-line-2)] text-[12.5px] focus:border-[var(--color-accent)]/40 focus:ring-1 focus:ring-[var(--color-accent)]/20 transition-all" placeholder="Template name" />
          <textarea value={instructions} onChange={e => setInstructions(e.target.value)} className="w-full min-h-[80px] px-3 py-2 rounded-lg bg-[var(--color-ink-2)] border border-[var(--color-line-2)] text-[12.5px] focus:border-[var(--color-accent)]/40 focus:ring-1 focus:ring-[var(--color-accent)]/20 transition-all" placeholder="Initial email guidance, tone, CTA, positioning…" />
          <textarea value={followupInstructions} onChange={e => setFollowupInstructions(e.target.value)} className="w-full min-h-[80px] px-3 py-2 rounded-lg bg-[var(--color-ink-2)] border border-[var(--color-line-2)] text-[12.5px] focus:border-[var(--color-accent)]/40 focus:ring-1 focus:ring-[var(--color-accent)]/20 transition-all" placeholder="Follow-up guidance, objection handling, CTA…" />
          <button onClick={saveTemplate} disabled={saving || !name.trim()} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full btn-primary text-xs disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98] transition-transform">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Save as default
          </button>
          {loading ? <p className="text-xs text-[var(--color-text-4)]">Loading…</p> : (
            <div className="space-y-2">
              {templates.map(t => (
                <div key={t.id} className="rounded-lg border border-[var(--color-line-1)] bg-white px-3 py-2 hover:shadow-sm transition-shadow">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-[var(--color-text-1)]">{t.name}</p>
                      <p className="text-[11px] text-[var(--color-text-4)]">{t.is_default ? 'Default template' : 'Saved template'}</p>
                    </div>
                    {!t.is_default && <button onClick={() => makeDefault(t.id)} className="text-[11px] text-[var(--color-accent-ring)] hover:text-[var(--color-accent)] transition-colors">Make default</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
