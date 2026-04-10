'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// ── Sub-industries ────────────────────────────────────────────────

const INDUSTRY_GROUPS = [
  {
    group: 'Technology',
    items: [
      { value: 'saas',         label: 'SaaS' },
      { value: 'devtools',     label: 'DevTools' },
      { value: 'cybersecurity',label: 'Cybersecurity' },
      { value: 'data_ai',      label: 'Data & AI' },
      { value: 'martech',      label: 'MarTech' },
      { value: 'hrtech',       label: 'HR Tech' },
      { value: 'proptech',     label: 'PropTech' },
      { value: 'legaltech',    label: 'LegalTech' },
      { value: 'edtech',       label: 'EdTech' },
      { value: 'ecommerce',    label: 'E-commerce' },
    ],
  },
  {
    group: 'Finance',
    items: [
      { value: 'fintech',      label: 'FinTech' },
      { value: 'insurtech',    label: 'InsurTech' },
      { value: 'wealthtech',   label: 'WealthTech' },
      { value: 'payments',     label: 'Payments' },
      { value: 'regtech',      label: 'RegTech' },
    ],
  },
  {
    group: 'Health',
    items: [
      { value: 'healthtech',   label: 'HealthTech' },
      { value: 'biotech',      label: 'BioTech' },
      { value: 'medtech',      label: 'MedTech' },
      { value: 'pharma',       label: 'Pharma' },
      { value: 'digital_health',label: 'Digital Health' },
    ],
  },
]

const ALL_INDUSTRIES = INDUSTRY_GROUPS.flatMap(g => g.items)
type IndustryValue = typeof ALL_INDUSTRIES[number]['value']

const SIGNAL_TYPES = [
  { value: 'funding',     label: '💰 Funding rounds' },
  { value: 'acquisition', label: '🤝 Acquisitions' },
  { value: 'expansion',   label: '🌍 Market expansion' },
  { value: 'regulation',  label: '⚖️ Regulation changes' },
  { value: 'hiring',      label: '👥 C-suite hiring' },
]

// ── Component ─────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isEdit, setIsEdit] = useState(false)
  const [form, setForm] = useState({
    company_name: '',
    industry: '' as IndustryValue | '',
    target_industries: [] as IndustryValue[],
    services_description: '',
    calendly_url: '',
    target_signal_types: ['funding', 'acquisition', 'expansion', 'regulation', 'hiring'] as string[],
    min_relevance_score: 6,
  })

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('company_name, industry, target_industries, services_description, calendly_url, target_signal_types, min_relevance_score')
        .eq('user_id', user.id)
        .single()

      if (profile) {
        setIsEdit(true)
        setForm({
          company_name:         profile.company_name || '',
          industry:             (profile.industry as IndustryValue) || '',
          target_industries:    (profile.target_industries as IndustryValue[]) || [],
          services_description: profile.services_description || '',
          calendly_url:         (profile as { calendly_url?: string }).calendly_url || '',
          target_signal_types:  (profile.target_signal_types as string[]) || ['funding', 'acquisition', 'expansion', 'regulation', 'hiring'],
          min_relevance_score:  (profile.min_relevance_score as number) || 6,
        })
      }
      setLoading(false)
    }
    loadProfile()
  }, [])

  function toggleTargetIndustry(val: IndustryValue) {
    setForm(f => ({
      ...f,
      target_industries: f.target_industries.includes(val)
        ? f.target_industries.filter(i => i !== val)
        : [...f.target_industries, val],
    }))
  }

  function toggleSignalType(val: string) {
    setForm(f => ({
      ...f,
      target_signal_types: f.target_signal_types.includes(val)
        ? f.target_signal_types.filter(s => s !== val)
        : [...f.target_signal_types, val],
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.industry) return
    if (form.target_industries.length === 0) {
      setError('Select at least one target industry.')
      return
    }
    if (form.target_signal_types.length === 0) {
      setError('Select at least one signal type to watch.')
      return
    }
    setSaving(true)
    setError(null)

    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    if (!res.ok) {
      let msg = 'Something went wrong.'
      try {
        const body = await res.json()
        msg = body.error || msg
      } catch {}
      setError(msg)
      setSaving(false)
      return
    }

    router.push('/dashboard')
  }

  const isValid =
    form.company_name.trim().length > 1 &&
    form.industry !== '' &&
    form.target_industries.length > 0 &&
    form.services_description.trim().length > 20 &&
    form.target_signal_types.length > 0

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-600 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {isEdit ? 'Edit your profile' : 'Set up your profile'}
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            We use this to match you with companies that need what you offer.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-7">
          {/* Company name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Your company name</label>
            <input
              type="text"
              required
              placeholder="Acme Corp"
              value={form.company_name}
              onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Your industry */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Your industry</label>
            {INDUSTRY_GROUPS.map(group => (
              <div key={group.group} className="space-y-1.5">
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{group.group}</p>
                <div className="flex flex-wrap gap-2">
                  {group.items.map(ind => (
                    <button
                      key={ind.value}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, industry: ind.value as IndustryValue }))}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        form.industry === ind.value
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                      }`}
                    >
                      {ind.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Target industries */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">
              Industries you sell into{' '}
              <span className="text-gray-500 font-normal">(select all that apply)</span>
            </label>
            {INDUSTRY_GROUPS.map(group => (
              <div key={group.group} className="space-y-1.5">
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{group.group}</p>
                <div className="flex flex-wrap gap-2">
                  {group.items.map(ind => (
                    <button
                      key={ind.value}
                      type="button"
                      onClick={() => toggleTargetIndustry(ind.value as IndustryValue)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        form.target_industries.includes(ind.value as IndustryValue)
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                      }`}
                    >
                      {ind.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Signal types to watch */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">
              Signal types to watch{' '}
              <span className="text-gray-500 font-normal">(uncheck types that aren&apos;t useful for you)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {SIGNAL_TYPES.map(s => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => toggleSignalType(s.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    form.target_signal_types.includes(s.value)
                      ? 'bg-gray-700 border-gray-600 text-white'
                      : 'bg-gray-900 border-gray-800 text-gray-600'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Minimum relevance score */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">
              Minimum relevance score:{' '}
              <span className="text-indigo-400 font-semibold">{form.min_relevance_score}/10</span>
            </label>
            <input
              type="range"
              min={4}
              max={9}
              step={1}
              value={form.min_relevance_score}
              onChange={e => setForm(f => ({ ...f, min_relevance_score: Number(e.target.value) }))}
              className="w-full accent-indigo-500"
            />
            <div className="flex justify-between text-xs text-gray-600">
              <span>4 — more leads, lower quality</span>
              <span>9 — fewer leads, high quality</span>
            </div>
          </div>

          {/* What you offer */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">What do you offer?</label>
            <textarea
              required
              rows={4}
              placeholder="We provide AI-powered compliance automation software for financial institutions. Our platform cuts audit prep time by 70% and integrates with major core banking systems."
              value={form.services_description}
              onChange={e => setForm(f => ({ ...f, services_description: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
            <p className="text-xs text-gray-500">Be specific — this is what the AI uses to score relevance.</p>
          </div>

          {/* Calendly link */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">
              Calendly link{' '}
              <span className="text-gray-500 font-normal">(optional — added to every email draft)</span>
            </label>
            <input
              type="url"
              placeholder="https://calendly.com/yourname/15min"
              value={form.calendly_url}
              onChange={e => setForm(f => ({ ...f, calendly_url: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex items-center gap-3">
            {isEdit && (
              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="flex-1 py-3 rounded-xl border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={!isValid || saving}
              className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Start finding leads →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
