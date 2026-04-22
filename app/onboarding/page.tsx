'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// ── Data ──────────────────────────────────────────────────────────

const INDUSTRY_GROUPS = [
  {
    group: 'Technology',
    items: [
      { value: 'saas',          label: 'SaaS' },
      { value: 'devtools',      label: 'DevTools' },
      { value: 'cybersecurity', label: 'Cybersecurity' },
      { value: 'data_ai',       label: 'Data & AI' },
      { value: 'martech',       label: 'MarTech' },
      { value: 'hrtech',        label: 'HR Tech' },
      { value: 'proptech',      label: 'PropTech' },
      { value: 'legaltech',     label: 'LegalTech' },
      { value: 'edtech',        label: 'EdTech' },
      { value: 'ecommerce',     label: 'E-commerce' },
    ],
  },
  {
    group: 'Finance',
    items: [
      { value: 'fintech',    label: 'FinTech' },
      { value: 'insurtech',  label: 'InsurTech' },
      { value: 'wealthtech', label: 'WealthTech' },
      { value: 'payments',   label: 'Payments' },
      { value: 'regtech',    label: 'RegTech' },
    ],
  },
  {
    group: 'Health',
    items: [
      { value: 'healthtech',    label: 'HealthTech' },
      { value: 'biotech',       label: 'BioTech' },
      { value: 'medtech',       label: 'MedTech' },
      { value: 'pharma',        label: 'Pharma' },
      { value: 'digital_health',label: 'Digital Health' },
    ],
  },
] as const

type IndustryValue = typeof INDUSTRY_GROUPS[number]['items'][number]['value']

interface SignalType {
  value: string
  label: string
  desc: string
  icon: React.ReactNode
  color: string
}

const SIGNAL_TYPES: SignalType[] = [
  {
    value: 'funding',
    label: 'Funding rounds',
    desc: 'Seed through late-stage raises',
    color: 'var(--color-sig-funding)',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    value: 'acquisition',
    label: 'Acquisitions',
    desc: 'M&A activity & mergers',
    color: 'var(--color-sig-acquisition)',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    ),
  },
  {
    value: 'expansion',
    label: 'Market expansion',
    desc: 'New regions or product lines',
    color: 'var(--color-sig-expansion)',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    value: 'regulation',
    label: 'Regulation changes',
    desc: 'Compliance triggers',
    color: 'var(--color-sig-regulation)',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
      </svg>
    ),
  },
  {
    value: 'hiring',
    label: 'C-suite hiring',
    desc: 'New exec appointments',
    color: 'var(--color-sig-hiring)',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
]

const STEPS = ['Company', 'Targeting', 'Signals'] as const

// ── Component ─────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isEdit, setIsEdit] = useState(false)
  const [done, setDone] = useState(false)
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
      if (!user) {
        setLoading(false)
        return
      }

      const { data: profile } = await supabase
        .from('user_profiles')
        .select(
          'company_name, industry, target_industries, services_description, calendly_url, target_signal_types, min_relevance_score, active_client_id',
        )
        .eq('user_id', user.id)
        .single()

      const activeClientId = (profile as { active_client_id?: string | null } | null)?.active_client_id ?? null
      const { data: clientProfile } = activeClientId
        ? await supabase
            .from('client_accounts')
            .select('name, industry, target_industries, services_description, calendly_url, target_signal_types, min_relevance_score')
            .eq('id', activeClientId)
            .eq('user_id', user.id)
            .maybeSingle()
        : { data: null }

      const effectiveProfile = clientProfile ?? profile

      if (effectiveProfile) {
        setIsEdit(true)
        setForm({
          company_name:         (effectiveProfile as { name?: string; company_name?: string }).name || (effectiveProfile as { company_name?: string }).company_name || '',
          industry:             ((effectiveProfile as { industry?: IndustryValue }).industry as IndustryValue) || '',
          target_industries:    ((effectiveProfile as { target_industries?: IndustryValue[] }).target_industries) || [],
          services_description: (effectiveProfile as { services_description?: string }).services_description || '',
          calendly_url:         (effectiveProfile as { calendly_url?: string }).calendly_url || '',
          target_signal_types:  (effectiveProfile as { target_signal_types?: string[] }).target_signal_types || ['funding', 'acquisition', 'expansion', 'regulation', 'hiring'],
          min_relevance_score:  (effectiveProfile as { min_relevance_score?: number }).min_relevance_score || 6,
        })
      }
      setLoading(false)
    }
    loadProfile()
  }, [])

  function toggleTargetIndustry(val: IndustryValue) {
    setForm((f) => ({
      ...f,
      target_industries: f.target_industries.includes(val)
        ? f.target_industries.filter((i) => i !== val)
        : [...f.target_industries, val],
    }))
  }

  function toggleSignalType(val: string) {
    setForm((f) => ({
      ...f,
      target_signal_types: f.target_signal_types.includes(val)
        ? f.target_signal_types.filter((s) => s !== val)
        : [...f.target_signal_types, val],
    }))
  }

  // Step validation
  const stepValid = [
    form.company_name.trim().length > 1 && form.industry !== '' && form.services_description.trim().length > 20,
    form.target_industries.length > 0,
    form.target_signal_types.length > 0,
  ]

  async function handleSubmit() {
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

    if (isEdit) {
      router.push('/dashboard')
    } else {
      setDone(true)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[var(--color-line-2)] border-t-[var(--color-accent)] rounded-full animate-spin" />
      </div>
    )
  }

  if (done) {
    return (
      <div className="relative min-h-screen flex items-center justify-center px-4 py-12 overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="blob blob-1 w-[420px] h-[420px] top-[-100px] right-[-80px]" />

        <div className="relative w-full max-w-lg text-center space-y-8 fade-in">
          {/* pulse icon */}
          <div className="flex justify-center">
            <div className="relative w-20 h-20 flex items-center justify-center rounded-full bg-[var(--color-accent-bg)] border border-[var(--color-accent)]/20">
              <svg className="w-9 h-9 text-[var(--color-accent-ring)]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" />
                <circle cx="12" cy="12" r="7" strokeOpacity="0.5" />
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
              </svg>
              <span className="absolute top-1 right-1 w-3 h-3 rounded-full bg-[var(--color-accent)] pulse-dot" />
            </div>
          </div>

          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-text-1)]">
              You&rsquo;re all set.
            </h1>
            <p className="text-[17px] leading-[1.55] text-[var(--color-text-2)]">
              Bombsell is now scanning for buying signals matched to your ICP.
              Your first leads will appear in a few hours.
            </p>
            <p className="text-[14px] text-[var(--color-text-3)]">
              We&rsquo;ll send you an email the moment your first lead lands.
            </p>
          </div>

          <div className="card p-5 text-left space-y-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-4)] font-medium">What happens next</p>
            <ul className="space-y-2.5">
              {[
                'Signals ingested every hour from funding, hiring, and expansion sources',
                'Each signal scored against your ICP using AI',
                'Matched leads appear in your feed with a drafted outreach email ready to send',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[13px] text-[var(--color-text-2)]">
                  <span className="mt-0.5 w-4 h-4 rounded-full bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)] flex items-center justify-center shrink-0 text-[10px] font-semibold">
                    {i + 1}
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <button
            onClick={() => router.push('/dashboard')}
            className="h-12 px-8 rounded-full btn-primary text-[14px] font-medium inline-flex items-center gap-2"
          >
            Go to dashboard →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-12 overflow-hidden">
      {/* Ambient */}
      <div className="absolute inset-0 grid-bg opacity-40" />
      <div className="blob blob-1 w-[420px] h-[420px] top-[-100px] right-[-80px]" />

      <div className="relative w-full max-w-2xl">
        {/* Header */}
        <div className="mb-10 text-center space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            {isEdit ? 'Edit your profile' : 'Set up your signal profile'}
          </h1>
          <p className="text-sm text-[var(--color-text-3)]">
            Takes 60 seconds. Refine anytime.
          </p>
        </div>

        {/* Step indicator */}
        <StepIndicator current={step} steps={STEPS as unknown as string[]} />

        {/* Step panels — single panel animated in */}
        <div key={step} className="mt-8 fade-in">
          {step === 0 && (
            <StepCompany form={form} setForm={setForm} />
          )}
          {step === 1 && (
            <StepTargeting
              form={form}
              toggleTargetIndustry={toggleTargetIndustry}
            />
          )}
          {step === 2 && (
            <StepSignals
              form={form}
              setForm={setForm}
              toggleSignalType={toggleSignalType}
            />
          )}
        </div>

        {error && (
          <p className="mt-6 text-sm text-[var(--color-sig-regulation)] text-center">{error}</p>
        )}

        {/* Nav buttons */}
        <div className="mt-10 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              if (step === 0 && isEdit) router.push('/dashboard')
              else setStep((s) => Math.max(0, s - 1))
            }}
            className="btn-ghost px-5 py-2.5 rounded-full text-sm font-medium"
          >
            {step === 0 ? (isEdit ? 'Cancel' : 'Back') : '← Back'}
          </button>

          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-all ${
                  i === step
                    ? 'bg-[var(--color-accent)] w-4'
                    : i < step
                      ? 'bg-[var(--color-accent-ring)]'
                      : 'bg-[var(--color-line-2)]'
                }`}
              />
            ))}
          </div>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => stepValid[step] && setStep((s) => s + 1)}
              disabled={!stepValid[step]}
              className="btn-primary px-5 py-2.5 rounded-full text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue →
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!stepValid[2] || saving}
              className="btn-primary px-5 py-2.5 rounded-full text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Finish setup'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Step indicator ─────────────────────────────────────────────────

function StepIndicator({ current, steps }: { current: number; steps: string[] }) {
  return (
    <div className="flex items-center gap-3 justify-center">
      {steps.map((label, i) => {
        const active = i === current
        const done = i < current
        return (
          <div key={label} className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-full border flex items-center justify-center text-xs font-semibold transition-colors ${
                  active
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]'
                    : done
                      ? 'border-[var(--color-accent)]/40 bg-white text-[var(--color-accent-ring)]'
                      : 'border-[var(--color-line-2)] bg-white text-[var(--color-text-4)]'
                }`}
              >
                {done ? (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-sm ${
                  active ? 'text-[var(--color-text-1)] font-medium' : 'text-[var(--color-text-3)]'
                }`}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span className="w-8 h-px bg-[var(--color-line-2)]" />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Step 1: Company ────────────────────────────────────────────────

interface StepFormProps {
  form: {
    company_name: string
    industry: IndustryValue | ''
    target_industries: IndustryValue[]
    services_description: string
    calendly_url: string
    target_signal_types: string[]
    min_relevance_score: number
  }
  setForm: React.Dispatch<React.SetStateAction<StepFormProps['form']>>
}

function StepCompany({ form, setForm }: StepFormProps) {
  return (
    <div className="card p-7 space-y-6">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-text-3)] uppercase tracking-wider">
          Your company name
        </label>
        <input
          type="text"
          placeholder="Acme Corp"
          value={form.company_name}
          onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
          className="w-full px-4 py-3 rounded-xl bg-[var(--color-ink-2)] border border-[var(--color-line-2)] text-[var(--color-text-1)] placeholder-[var(--color-text-4)] text-sm focus:outline-none focus:border-[var(--color-accent)] focus:bg-white focus:ring-2 focus:ring-[var(--color-accent)]/15 transition-colors"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-[var(--color-text-3)] uppercase tracking-wider">
          Your industry
        </label>
        {INDUSTRY_GROUPS.map((group) => (
          <div key={group.group} className="space-y-1.5 pt-2">
            <p className="text-[10px] text-[var(--color-text-4)] font-medium uppercase tracking-wider">
              {group.group}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((ind) => (
                <button
                  key={ind.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, industry: ind.value }))}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    form.industry === ind.value
                      ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white shadow-[0_2px_8px_-2px_#c15f3c66]'
                      : 'bg-white border-[var(--color-line-2)] text-[var(--color-text-2)] hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-accent-bg)]'
                  }`}
                >
                  {ind.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-text-3)] uppercase tracking-wider">
          What you offer
        </label>
        <textarea
          rows={4}
          placeholder="We provide AI-powered compliance automation software for financial institutions. Our platform cuts audit prep time by 70%…"
          value={form.services_description}
          onChange={(e) => setForm((f) => ({ ...f, services_description: e.target.value }))}
          className="w-full px-4 py-3 rounded-xl bg-[var(--color-ink-2)] border border-[var(--color-line-2)] text-[var(--color-text-1)] placeholder-[var(--color-text-4)] text-sm focus:outline-none focus:border-[var(--color-accent)] focus:bg-white focus:ring-2 focus:ring-[var(--color-accent)]/15 transition-all resize-none leading-relaxed"
        />
        <p className="text-[11px] text-[var(--color-text-4)]">
          The AI uses this to score every incoming signal. Be specific.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-text-3)] uppercase tracking-wider">
          Calendly link <span className="text-[var(--color-text-4)] normal-case font-normal">(optional)</span>
        </label>
        <input
          type="url"
          placeholder="https://calendly.com/yourname/15min"
          value={form.calendly_url}
          onChange={(e) => setForm((f) => ({ ...f, calendly_url: e.target.value }))}
          className="w-full px-4 py-3 rounded-xl bg-[var(--color-ink-2)] border border-[var(--color-line-2)] text-[var(--color-text-1)] placeholder-[var(--color-text-4)] text-sm focus:outline-none focus:border-[var(--color-accent)] focus:bg-white focus:ring-2 focus:ring-[var(--color-accent)]/15 transition-colors"
        />
      </div>
    </div>
  )
}

// ── Step 2: Targeting ──────────────────────────────────────────────

function StepTargeting({
  form,
  toggleTargetIndustry,
}: {
  form: StepFormProps['form']
  toggleTargetIndustry: (v: IndustryValue) => void
}) {
  return (
    <div className="card p-7 space-y-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-[var(--color-text-1)]">
          Who do you sell to?
        </h2>
        <p className="text-xs text-[var(--color-text-3)]">
          Click industries you target. Select multiple.
        </p>
      </div>
      <div className="space-y-3">
        {INDUSTRY_GROUPS.map((group) => (
          <div key={group.group} className="space-y-2">
            <p className="text-[10px] text-[var(--color-text-4)] font-medium uppercase tracking-wider">
              {group.group}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((ind) => {
                const selected = form.target_industries.includes(ind.value)
                return (
                  <button
                    key={ind.value}
                    type="button"
                    onClick={() => toggleTargetIndustry(ind.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      selected
                        ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white shadow-[0_2px_8px_-2px_#c15f3c66]'
                        : 'bg-white border-[var(--color-line-2)] text-[var(--color-text-2)] hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-accent-bg)]'
                    }`}
                  >
                    {selected && <span className="mr-1">✓</span>}
                    {ind.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[var(--color-text-4)] pt-2">
        Selected: <span className="text-[var(--color-text-2)]">{form.target_industries.length}</span>
      </p>
    </div>
  )
}

// ── Step 3: Signals ────────────────────────────────────────────────

function StepSignals({
  form,
  setForm,
  toggleSignalType,
}: {
  form: StepFormProps['form']
  setForm: StepFormProps['setForm']
  toggleSignalType: (v: string) => void
}) {
  return (
    <div className="card p-7 space-y-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-[var(--color-text-1)]">
          Which signals should we watch?
        </h2>
        <p className="text-xs text-[var(--color-text-3)]">
          Tap to toggle. Only selected signal types become leads.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {SIGNAL_TYPES.map((s) => {
          const active = form.target_signal_types.includes(s.value)
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => toggleSignalType(s.value)}
              className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all ${
                active
                  ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent-bg)] shadow-[0_2px_8px_-4px_#c15f3c40]'
                  : 'border-[var(--color-line-2)] bg-white hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-ink-2)]'
              }`}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  background: active ? s.color + '22' : 'var(--color-ink-2)',
                  color: active ? s.color : 'var(--color-text-3)',
                }}
              >
                {s.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-sm font-medium ${
                      active ? 'text-[var(--color-text-1)]' : 'text-[var(--color-text-2)]'
                    }`}
                  >
                    {s.label}
                  </span>
                  <span
                    className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                      active
                        ? 'bg-[var(--color-accent)] border-[var(--color-accent)]'
                        : 'border-[var(--color-line-3)]'
                    }`}
                  >
                    {active && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-4)] mt-0.5">{s.desc}</p>
              </div>
            </button>
          )
        })}
      </div>

      {/* Score slider */}
      <div className="space-y-3 pt-3 border-t border-[var(--color-line-1)]">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-[var(--color-text-3)] uppercase tracking-wider">
            Minimum relevance
          </label>
          <span className="text-sm font-semibold text-[var(--color-accent-ring)] tabular-nums">
            {form.min_relevance_score}/10
          </span>
        </div>
        <input
          type="range"
          min={4}
          max={9}
          step={1}
          value={form.min_relevance_score}
          onChange={(e) => setForm((f) => ({ ...f, min_relevance_score: Number(e.target.value) }))}
          className="w-full accent-[var(--color-accent)]"
        />
        <div className="flex justify-between text-[10px] text-[var(--color-text-4)]">
          <span>More leads, lower quality</span>
          <span>Fewer leads, high quality</span>
        </div>
      </div>
    </div>
  )
}
