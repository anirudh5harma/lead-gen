'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Icon from '@/components/Icon'
import { useToast } from '@/components/Toast'

/**
 * Onboarding — editorial 2-step calibration flow, styled after the Stitch
 * "Bombsell — Onboarding Refined" screen.
 *
 *   Step 01  Identity     → website → auto-fill what-you-sell, industry, booking link
 *   Step 02  Calibration  → target industries · signals to listen for · min fit score
 *   Done                  → "You're live."
 */

const INDUSTRIES = [
  ['saas', 'SaaS'], ['devtools', 'DevTools'], ['cybersecurity', 'Cybersecurity'],
  ['data_ai', 'AI Infrastructure'], ['martech', 'MarTech'], ['hrtech', 'HR Tech'],
  ['proptech', 'PropTech'], ['legaltech', 'LegalTech'], ['edtech', 'EdTech'],
  ['ecommerce', 'E-commerce'], ['fintech', 'FinTech'], ['insurtech', 'InsurTech'],
  ['payments', 'Payments'], ['regtech', 'RegTech'], ['healthtech', 'Healthcare'],
  ['biotech', 'BioTech'], ['medtech', 'MedTech'], ['logistics', 'Logistics & Supply Chain'],
] as const

type IndustryValue = typeof INDUSTRIES[number][0]

const SIGNALS = [
  ['funding', 'Recent Series B/C funding'],
  ['hiring', 'New VP of Sales hire'],
  ['acquisition', 'Acquisitions & M&A activity'],
  ['expansion', 'Market expansion'],
  ['regulation', 'Regulatory or compliance change'],
] as const

interface Form {
  company_name: string
  industry: IndustryValue | ''
  website_url: string
  services_description: string
  target_industries: IndustryValue[]
  target_signal_types: string[]
  min_relevance_score: number
  icp_keywords: string[]
  calendly_url: string
  engines: Array<'outbound' | 'content'>
}

interface EditableProfile {
  active_client_id?: string | null
  company_name?: string | null
  industry?: string | null
  website_url?: string | null
  target_industries?: string[] | null
  services_description?: string | null
  calendly_url?: string | null
  icp_keywords?: string[] | null
  target_signal_types?: string[] | null
  min_relevance_score?: number | null
}

const INITIAL: Form = {
  company_name: '',
  industry: '',
  website_url: '',
  services_description: '',
  target_industries: [],
  target_signal_types: ['funding', 'hiring', 'acquisition', 'expansion'],
  min_relevance_score: 8,
  icp_keywords: [],
  calendly_url: '',
  engines: ['outbound'],
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<0 | 1>(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [analysing, setAnalysing] = useState(false)
  const [isEdit, setIsEdit] = useState(false)
  const [done, setDone] = useState(false)
  const toast = useToast()
  const [form, setForm] = useState<Form>(INITIAL)

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('active_client_id, company_name, industry, website_url, target_industries, services_description, calendly_url, icp_keywords, target_signal_types, min_relevance_score')
        .eq('user_id', user.id)
        .single()

      let workspaceProfile: EditableProfile | null = null
      const activeClientId = (profile as { active_client_id?: string | null } | null)?.active_client_id ?? null
      if (activeClientId) {
        const { data: client } = await supabase
          .from('client_accounts')
          .select('name, industry, website_url, target_industries, services_description, calendly_url, icp_keywords, target_signal_types, min_relevance_score')
          .eq('id', activeClientId)
          .maybeSingle()
        if (client) {
          workspaceProfile = {
            ...profile,
            company_name: client.name,
            industry: client.industry,
            website_url: client.website_url,
            target_industries: client.target_industries,
            services_description: client.services_description,
            calendly_url: client.calendly_url,
            icp_keywords: client.icp_keywords,
            target_signal_types: client.target_signal_types,
            min_relevance_score: client.min_relevance_score,
          }
        }
      }

      const landingUrl = readLandingPrefill()
      const editableProfile = workspaceProfile ?? (profile as EditableProfile | null)

      if (editableProfile) {
        setIsEdit(true)
        setForm({
          company_name:         (editableProfile.company_name as string) || '',
          industry:             (editableProfile.industry as IndustryValue) || '',
          website_url:          (editableProfile.website_url as string) || landingUrl,
          services_description: (editableProfile.services_description as string) || '',
          target_industries:    (editableProfile.target_industries as IndustryValue[]) || [],
          target_signal_types:  (editableProfile.target_signal_types as string[]) || INITIAL.target_signal_types,
          min_relevance_score:  (editableProfile.min_relevance_score as number) || 8,
          icp_keywords:         (editableProfile.icp_keywords as string[]) || [],
          calendly_url:         (editableProfile.calendly_url as string) || '',
          engines:              INITIAL.engines,
        })
      } else if (landingUrl) {
        setForm((f) => ({ ...f, website_url: landingUrl, company_name: companyNameFromWebsite(landingUrl) }))
      }
      setLoading(false)
    })()
  }, [])

  async function autoFillFromWebsite() {
    if (!form.website_url) { toast.error('Add your company website first.'); return }
    setAnalysing(true)
    try {
      const res = await fetch('/api/profile/website-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website_url: form.website_url,
          company_name: form.company_name || undefined,
          industries: INDUSTRIES.map(([v]) => v),
        }),
      })
      const body = await res.json().catch(() => ({})) as { description?: string; website_url?: string; company_name?: string | null; industry?: string | null; error?: string }
      if (res.ok && body?.description) {
        setForm((f) => ({
          ...f,
          services_description: body.description!,
          website_url: body.website_url ?? f.website_url,
          company_name: f.company_name || (body.company_name ?? f.company_name),
          industry: f.industry || (body.industry && (INDUSTRIES as readonly (readonly [string, string])[]).some(([v]) => v === body.industry) ? (body.industry as IndustryValue) : f.industry),
        }))
      } else {
        toast.error(body?.error || 'Could not analyse that website. Type a description below.')
      }
    } catch {
      toast.error('Network issue. Type a description below.')
    } finally {
      setAnalysing(false)
    }
  }

  const stepValid: [boolean, boolean] = [
    form.company_name.trim().length > 1
      && form.industry !== ''
      && form.services_description.trim().length >= 10,
    form.target_industries.length > 0
      && form.target_signal_types.length > 0,
  ]

  async function submit() {
    setSaving(true)
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error || 'Something went wrong.')
      setSaving(false); return
    }
    window.localStorage.removeItem('bombsell:onboarding:website_url')
    if (isEdit) router.push('/dashboard')
    else setDone(true)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-3 h-3 bg-primary rounded-full animate-pulse" />
      </div>
    )
  }

  if (done) return <DoneState onOpen={() => router.push('/dashboard')} />

  return (
    <div className="min-h-screen flex flex-col bg-surface font-body-main text-on-surface">
      {/* Header — minimalist editorial */}
      <header className="sticky top-0 w-full z-40 bg-surface/80 backdrop-blur-md flex items-center justify-between px-margin-page h-20">
        <div className="font-bold text-[20px] tracking-tight text-primary">Bombsell</div>
        <button
          onClick={() => router.push(isEdit ? '/dashboard' : '/')}
          className="font-display-sm text-[12px] tracking-[0.1em] uppercase text-on-surface-variant hover:text-on-surface transition-all"
        >
          {isEdit ? 'Back to dashboard' : 'Save Draft'}
        </button>
      </header>

      <main className="max-w-3xl mx-auto w-full py-12 px-margin-page flex-1">
        {step === 0 ? (
          <StepIdentity
            form={form}
            setForm={setForm}
            analysing={analysing}
            onAnalyse={() => void autoFillFromWebsite()}
            canContinue={stepValid[0]}
            onContinue={() => setStep(1)}
          />
        ) : (
          <StepCalibration
            form={form}
            setForm={setForm}
            canFinalize={stepValid[1]}
            saving={saving}
            isEdit={isEdit}
            onFinalize={() => void submit()}
            onBack={() => setStep(0)}
          />
        )}
      </main>
    </div>
  )
}

/* ─── Step 01: Identity ───────────────────────────────────────── */

function StepIdentity({
  form, setForm, analysing, onAnalyse, canContinue, onContinue,
}: {
  form: Form; setForm: React.Dispatch<React.SetStateAction<Form>>;
  analysing: boolean; onAnalyse: () => void;
  canContinue: boolean; onContinue: () => void;
}) {
  // first 5 industries shown as Stitch-style chips, rest behind ChipPicker expand
  return (
    <section className="space-y-stack-lg">
      <div className="space-y-base">
        <span className="font-display-sm text-[11px] tracking-widest text-primary uppercase">Step 01 — Your company</span>
        <h2 className="font-h1-editorial text-[56px] leading-tight">Point the fleet at your market.</h2>
        <p className="font-body-main text-on-surface-variant max-w-xl">Drop your website and hit Analyse — we&rsquo;ll read it and fill in the rest. Everything below stays editable.</p>
      </div>

      <div className="bg-surface-container-lowest hairline-border p-stack-lg space-y-stack-md">
        {/* Website + Analyse — the primary action */}
        <div className="space-y-stack-sm">
          <label className="font-display-sm text-[10px] tracking-wider text-on-surface-variant uppercase">Company website</label>
          <div className="flex flex-col sm:flex-row gap-stack-sm">
            <input
              value={form.website_url}
              onChange={(e) => setForm({ ...form, website_url: e.target.value })}
              placeholder="yourcompany.com"
              inputMode="url"
              className="flex-1 bg-transparent border-b border-outline-variant py-2 font-body-large text-on-surface placeholder:text-outline/40 outline-none focus:border-primary"
            />
            <button
              onClick={onAnalyse}
              disabled={!form.website_url || analysing}
              className="shrink-0 bg-primary text-on-primary font-display-sm text-[11px] tracking-widest uppercase px-5 py-2.5 hover:bg-primary-container transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <Icon name="psychology" size={16} /> {analysing ? 'Analysing…' : 'Analyse website'}
            </button>
          </div>
          {form.website_url
            ? <p className="font-display-sm text-[9px] text-outline/60 uppercase">{analysing ? 'Reading your site…' : 'Analyse fills in your company name, industry, and what you sell.'}</p>
            : <p className="font-display-sm text-[9px] text-outline/60 uppercase">No site? You can fill the fields below by hand.</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-stack-md pt-stack-sm">
          <FieldUnderline label="Company Name">
            <input
              value={form.company_name}
              onChange={(e) => setForm({ ...form, company_name: e.target.value })}
              onBlur={() => { if (!form.company_name && form.website_url) setForm(f => ({ ...f, company_name: companyNameFromWebsite(f.website_url) })) }}
              placeholder="Acme Inc"
              className="w-full bg-transparent border-b border-outline-variant py-2 font-body-large text-on-surface placeholder:text-outline/40 outline-none focus:border-primary"
            />
          </FieldUnderline>
        </div>

        <div className="space-y-stack-sm pt-stack-sm">
          <label className="font-display-sm text-[10px] tracking-wider text-on-surface-variant uppercase">Industry</label>
          <ChipRow
            items={INDUSTRIES}
            selected={form.industry ? [form.industry] : []}
            onToggle={(v) => setForm({ ...form, industry: v as IndustryValue })}
          />
        </div>

        <div className="space-y-base pt-stack-sm">
          <label className="font-display-sm text-[10px] tracking-wider text-on-surface-variant uppercase">What you sell</label>
          <textarea
            value={form.services_description}
            onChange={(e) => setForm({ ...form, services_description: e.target.value })}
            placeholder="What you sell, who it helps, the outcomes — or hit Analyse above to draft this from your site."
            rows={4}
            className="w-full bg-transparent border border-outline-variant/30 p-3 font-body-main text-on-surface resize-none outline-none focus:border-primary"
          />
        </div>

        <div className="space-y-base">
          <label className="font-display-sm text-[10px] tracking-wider text-on-surface-variant uppercase">
            Booking Link <span className="text-outline/60 lowercase ml-1">(optional)</span>
          </label>
          <input
            value={form.calendly_url}
            onChange={(e) => setForm({ ...form, calendly_url: e.target.value })}
            placeholder="calendly.com/your-team"
            type="url"
            className="w-full bg-transparent border-b border-outline-variant py-2 font-body-large text-on-surface placeholder:text-outline/40 outline-none focus:border-primary"
          />
          <div className="flex items-center gap-3 pt-1">
            <span className="font-display-sm text-[9px] text-outline/60 uppercase">Suggestions:</span>
            <button onClick={() => setForm({ ...form, calendly_url: 'https://cal.com/' })} className="font-display-sm text-[9px] text-primary hover:underline uppercase tracking-wider">cal.com</button>
            <button onClick={() => setForm({ ...form, calendly_url: 'https://calendly.com/' })} className="font-display-sm text-[9px] text-primary hover:underline uppercase tracking-wider">calendly.com</button>
          </div>
        </div>

        <div className="pt-stack-md flex justify-end">
          <button
            onClick={() => canContinue && onContinue()}
            disabled={!canContinue}
            className="bg-primary text-on-primary font-display-sm text-[12px] tracking-widest uppercase px-10 py-4 hover:bg-primary-container transition-colors disabled:opacity-40"
          >
            Continue to Targets
          </button>
        </div>
      </div>
    </section>
  )
}

/* ─── Step 02: Calibration ────────────────────────────────────── */

function StepCalibration({
  form, setForm, canFinalize, saving, isEdit, onFinalize, onBack,
}: {
  form: Form; setForm: React.Dispatch<React.SetStateAction<Form>>;
  canFinalize: boolean; saving: boolean; isEdit: boolean;
  onFinalize: () => void; onBack: () => void;
}) {
  function toggleTarget(v: IndustryValue) {
    setForm((f) => ({
      ...f,
      target_industries: f.target_industries.includes(v)
        ? f.target_industries.filter((x) => x !== v)
        : [...f.target_industries, v],
    }))
  }
  function toggleSignal(v: string) {
    setForm((f) => ({
      ...f,
      target_signal_types: f.target_signal_types.includes(v)
        ? f.target_signal_types.filter((x) => x !== v)
        : [...f.target_signal_types, v],
    }))
  }
  const pct = form.min_relevance_score * 10

  return (
    <section className="space-y-stack-lg">
      <button onClick={onBack} className="font-display-sm text-[10px] tracking-widest uppercase text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1">
        <Icon name="arrow_back" size={14} /> Back to identity
      </button>
      <div className="space-y-base">
        <span className="font-display-sm text-[11px] tracking-widest text-primary uppercase">Step 02 — Calibration</span>
        <h2 className="font-h1-editorial text-[56px] leading-tight">Who&rsquo;s a good account?</h2>
      </div>

      <div className="bg-surface-container-lowest hairline-border p-stack-lg space-y-stack-md">
        <div className="space-y-stack-sm">
          <label className="font-display-sm text-[10px] tracking-wider text-on-surface-variant uppercase">Engines to run</label>
          <div className="grid grid-cols-2 gap-px bg-outline-variant/30 hairline-border">
            {([
              ['outbound', 'Outbound', 'Signal → match → enrich → draft → send → reply → book'],
              ['content', 'Content', 'Idea → write → edit → schedule → publish → learn (LinkedIn / X)'],
            ] as Array<['outbound' | 'content', string, string]>).map(([id, label, desc]) => {
              const on = form.engines.includes(id)
              return (
                <button key={id} type="button"
                  onClick={() => setForm(f => ({ ...f, engines: on ? f.engines.filter(e => e !== id) : [...f.engines, id] }))}
                  className={`text-left p-stack-md transition-colors ${on ? 'bg-secondary-container/40' : 'bg-surface-container-lowest hover:bg-surface-container-low'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-3 h-3 rounded-full ${on ? 'bg-tertiary' : 'bg-outline-variant'}`} />
                    <span className="font-body-main font-medium text-on-surface">{label}</span>
                  </div>
                  <p className="font-body-main text-[12px] text-on-surface-variant">{desc}</p>
                </button>
              )
            })}
          </div>
          <p className="font-label-mono text-[9px] uppercase text-on-surface-variant">You can change which agents run, and add the other engine, any time from Agents → Stacks.</p>
        </div>

        <div className="space-y-stack-sm pt-stack-sm">
          <label className="font-display-sm text-[10px] tracking-wider text-on-surface-variant uppercase">Target Industries</label>
          <ChipRow
            items={INDUSTRIES}
            selected={form.target_industries}
            onToggle={(v) => toggleTarget(v as IndustryValue)}
          />
        </div>

        <div className="space-y-stack-sm pt-stack-sm">
          <label className="font-display-sm text-[10px] tracking-wider text-on-surface-variant uppercase">Listen for Signals</label>
          <div className="divide-y divide-outline-variant/20 border-y border-outline-variant/20">
            {SIGNALS.map(([id, label]) => {
              const on = form.target_signal_types.includes(id)
              return (
                <button
                  key={id}
                  onClick={() => toggleSignal(id)}
                  className="w-full flex items-center justify-between h-12 hover:bg-surface-container-low px-2 transition-colors text-left"
                >
                  <span className="font-body-main">{label}</span>
                  <span className={`w-8 h-4 rounded-full relative shrink-0 transition-colors ${on ? 'bg-primary' : 'bg-outline-variant'}`}>
                    <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${on ? 'right-0.5' : 'left-0.5'}`} />
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-stack-sm pt-stack-sm">
          <div className="flex justify-between items-center">
            <label className="font-display-sm text-[10px] tracking-wider text-on-surface-variant uppercase">Minimum Fit Score</label>
            <span className="font-display-sm text-[14px] text-primary">{pct}%</span>
          </div>
          <input
            type="range" min={1} max={10} step={1}
            value={form.min_relevance_score}
            onChange={(e) => setForm({ ...form, min_relevance_score: Number(e.target.value) })}
            className="w-full h-1 range-slider cursor-pointer"
          />
          <div className="flex justify-between font-display-sm text-[9px] text-outline/60 uppercase">
            <span>Volume</span>
            <span>Precision</span>
          </div>
        </div>

        <div className="pt-stack-md flex justify-end">
          <button
            onClick={() => canFinalize && !saving && onFinalize()}
            disabled={!canFinalize || saving}
            className="bg-primary text-on-primary font-display-sm text-[12px] tracking-widest uppercase px-10 py-4 hover:bg-primary-container transition-colors disabled:opacity-40"
          >
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Finalize Setup'}
          </button>
        </div>
      </div>
    </section>
  )
}

/* ─── Done ────────────────────────────────────────────────────── */

function DoneState({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-surface px-margin-page text-center space-y-stack-md">
      <div className="relative inline-block mb-4">
        <div className="w-3 h-3 bg-primary rounded-full animate-pulse mx-auto" />
        <div className="absolute inset-0 w-3 h-3 bg-primary rounded-full blur-md opacity-40" />
      </div>
      <div className="space-y-base">
        <h2 className="font-h1-editorial text-[72px] text-on-surface">You&rsquo;re live.</h2>
        <p className="font-body-large text-on-surface-variant max-w-md mx-auto opacity-80">
          You&rsquo;re live. Your agents are indexing target accounts and listening for signals — outbound and content.
        </p>
      </div>
      <div className="pt-10">
        <button
          onClick={onOpen}
          className="border border-primary text-primary font-display-sm text-[12px] tracking-widest uppercase px-10 py-4 hover:bg-primary hover:text-on-primary transition-all"
        >
          Go to Dashboard
        </button>
      </div>
    </div>
  )
}

/* ─── Primitives ──────────────────────────────────────────────── */

function FieldUnderline({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-base">
      <label className="font-display-sm text-[10px] tracking-wider text-on-surface-variant uppercase">{label}</label>
      <div className="relative flex items-center">{children}</div>
    </div>
  )
}

function ChipRow({
  items, selected, onToggle,
}: {
  items: ReadonlyArray<readonly [string, string]>;
  selected: string[];
  onToggle: (v: string) => void;
}) {
  const [expanded, setExpanded] = useState(false)
  const COLLAPSED = 6
  const collapsible = items.length > COLLAPSED
  const visible = expanded || !collapsible ? items : items.slice(0, COLLAPSED)
  return (
    <div className="flex flex-wrap gap-2">
      {visible.map(([v, label]) => {
        const on = selected.includes(v)
        return (
          <button
            key={v}
            onClick={() => onToggle(v)}
            className={`px-3 py-1 font-display-sm text-[10px] uppercase rounded-sm cursor-pointer transition-colors border ${
              on
                ? 'bg-primary text-on-primary border-primary'
                : 'bg-surface-container-high text-on-surface-variant border-transparent hover:border-primary'
            }`}
          >
            {label}
          </button>
        )
      })}
      {collapsible && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="px-3 py-1 font-display-sm text-[10px] uppercase rounded-sm text-on-surface-variant hover:text-primary"
        >
          {expanded ? '− Less' : `+ ${items.length - COLLAPSED} More`}
        </button>
      )}
    </div>
  )
}

/* ─── Helpers ─────────────────────────────────────────────────── */

function readLandingPrefill(): string {
  if (typeof window === 'undefined') return ''
  const value = window.localStorage.getItem('bombsell:onboarding:website_url') ?? ''
  if (!value) return ''
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    if (!url.hostname.includes('.') || url.hostname === 'localhost') return ''
    url.hash = ''
    return url.toString()
  } catch { return '' }
}

function companyNameFromWebsite(value: string): string {
  try {
    const host = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./i, '')
    const base = host.split('.')[0] ?? ''
    return base.split(/[-_]/).filter(Boolean).map(p => p[0].toUpperCase() + p.slice(1)).join(' ')
  } catch { return '' }
}
