'use client'

import type { ChangeEvent, FormEvent } from 'react'
import { useState, useEffect } from 'react'
import { useToast } from '@/components/Toast'

interface WatchlistCompany {
  id: string
  company_name: string
  company_domain: string | null
  notes: string | null
  created_at: string
}

export default function WatchlistManager() {
  const [companies, setCompanies] = useState<WatchlistCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [form, setForm] = useState({ company_name: '', company_domain: '', notes: '' })
  const toast = useToast()

  useEffect(() => {
    fetch('/api/watchlist')
      .then(r => r.json())
      .then(d => { setCompanies(d.companies ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function addCompany(e: FormEvent) {
    e.preventDefault()
    if (!form.company_name.trim()) return
    setAdding(true)

    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    const data = await res.json()

    if (!res.ok) {
      toast.error(data.error || 'Failed to add company')
      setAdding(false)
      return
    }

    setCompanies(prev => [data.company, ...prev])
    setForm({ company_name: '', company_domain: '', notes: '' })
    setAdding(false)
  }

  async function uploadCsv(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setUploading(true)

    try {
      const text = await file.text()
      const companies = parseWatchlistCsv(text)
      if (companies.length === 0) {
        toast.error('No company rows found. Use columns like company_name and company_domain, or name,domain.')
        return
      }

      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companies }),
      })
      const data = await res.json().catch(() => null) as {
        companies?: WatchlistCompany[]
        inserted?: number
        skipped?: number
        error?: string
      } | null

      if (!res.ok) {
        toast.error(data?.error || 'Failed to upload watchlist CSV')
        return
      }

      setCompanies(prev => mergeCompanies(data?.companies ?? [], prev))
      toast.success(`Imported ${data?.inserted ?? data?.companies?.length ?? 0} companies${data?.skipped ? `, skipped ${data.skipped}` : ''}.`)
    } catch {
      toast.error('Failed to read watchlist CSV')
    } finally {
      setUploading(false)
    }
  }

  async function removeCompany(id: string) {
    const res = await fetch('/api/watchlist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      setCompanies(prev => prev.filter(c => c.id !== id))
    } else {
      toast.error('Failed to remove company')
    }
  }

  return (
    <div className="card bg-[var(--color-ink-0)]">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 h-11 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 text-[var(--color-accent-ring)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
          <span className="text-sm font-medium text-[var(--color-text-1)]">
            Watchlist
          </span>
          {!loading && (
            <span className="text-[11px] text-[var(--color-text-4)] truncate">
              {companies.length} {companies.length === 1 ? 'company' : 'companies'} · signals boosted
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-[var(--color-text-4)] transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-[var(--color-line-1)] pt-3">
          {/* Add form */}
          <form onSubmit={addCompany} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="Company name"
              value={form.company_name}
              onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))}
              className="flex-1 min-w-0 px-3 h-9 rounded-lg bg-[var(--color-ink-0)] border border-[var(--color-line-2)] text-sm text-[var(--color-text-1)] placeholder:text-[var(--color-text-4)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/15 transition-colors"
            />
            <input
              type="text"
              placeholder="domain.com (optional)"
              value={form.company_domain}
              onChange={e => setForm(f => ({ ...f, company_domain: e.target.value }))}
              className="sm:w-40 min-w-0 px-3 h-9 rounded-lg bg-[var(--color-ink-0)] border border-[var(--color-line-2)] text-sm text-[var(--color-text-1)] placeholder:text-[var(--color-text-4)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/15 transition-colors"
            />
            <button
              type="submit"
              disabled={adding || !form.company_name.trim()}
              className="btn-primary px-4 h-9 rounded-full text-sm disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {adding ? '…' : 'Watch'}
            </button>
          </form>

          <div className="rounded-xl border border-dashed border-[var(--color-line-2)] bg-[var(--color-ink-0)] px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-[var(--color-text-1)]">Upload CSV</p>
                <p className="mt-0.5 text-[11px] text-[var(--color-text-4)]">
                  Supports company_name/company and company_domain/domain columns.
                </p>
              </div>
              <label className="inline-flex h-8 cursor-pointer items-center rounded-full border border-[var(--color-line-2)] bg-[var(--color-ink-0)] px-3 text-[11px] font-medium text-[var(--color-text-1)] transition-colors hover:bg-[var(--color-ink-2)]">
                {uploading ? 'Uploading…' : 'Choose CSV'}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={uploadCsv}
                  disabled={uploading}
                  className="sr-only"
                />
              </label>
            </div>
          </div>

          {/* Company list */}
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map(i => (
                <div key={i} className="h-8 rounded skeleton" />
              ))}
            </div>
          ) : companies.length === 0 ? (
            <p className="text-xs text-[var(--color-text-4)] py-2">
              Add companies you care about — any signal from them bypasses the relevance filter.
            </p>
          ) : (
            <div className="space-y-1">
              {companies.map(c => (
                <div
                  key={c.id}
                  className="flex items-center justify-between px-3 h-9 rounded-lg bg-[var(--color-ink-2)] border border-[var(--color-line-1)] group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-[var(--color-text-1)] truncate">
                      {c.company_name}
                    </span>
                    {c.company_domain && (
                      <span className="text-[11px] text-[var(--color-text-4)] shrink-0">
                        {c.company_domain}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => removeCompany(c.id)}
                    aria-label="Remove"
                    className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 text-[var(--color-text-4)] hover:text-[var(--color-sig-regulation)] transition-all p-1 shrink-0"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function parseWatchlistCsv(text: string): Array<{ company_name: string; company_domain?: string }> {
  const rows = parseCsvRows(text).filter(row => row.some(cell => cell.trim()))
  if (rows.length === 0) return []

  const headers = rows[0].map(cell => normalizeHeader(cell))
  const hasHeader = headers.some(header => ['company_name', 'company', 'name', 'company_domain', 'domain', 'website'].includes(header))
  const dataRows = hasHeader ? rows.slice(1) : rows
  const companyIndex = hasHeader
    ? firstIndex(headers, ['company_name', 'company', 'name', 'account', 'account_name'])
    : 0
  const domainIndex = hasHeader
    ? firstIndex(headers, ['company_domain', 'domain', 'website', 'url'])
    : 1

  if (companyIndex < 0) return []

  const seen = new Set<string>()
  const companies: Array<{ company_name: string; company_domain?: string }> = []

  for (const row of dataRows) {
    const companyName = row[companyIndex]?.trim()
    if (!companyName) continue
    const companyDomain = normalizeDomain(row[domainIndex]?.trim() ?? '')
    const key = `${companyName.toLowerCase()}|${companyDomain}`
    if (seen.has(key)) continue
    seen.add(key)
    companies.push({
      company_name: companyName,
      ...(companyDomain ? { company_domain: companyDomain } : {}),
    })
  }

  return companies.slice(0, 500)
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (char === '"' && inQuotes && next === '"') {
      cell += '"'
      i += 1
    } else if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  row.push(cell)
  rows.push(row)
  return rows
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function firstIndex(values: string[], candidates: string[]): number {
  return candidates.map(candidate => values.indexOf(candidate)).find(index => index >= 0) ?? -1
}

function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .replace(/[,\s]+$/, '')
}

function mergeCompanies(incoming: WatchlistCompany[], current: WatchlistCompany[]): WatchlistCompany[] {
  const seen = new Set<string>()
  const merged: WatchlistCompany[] = []
  for (const company of [...incoming, ...current]) {
    const key = `${company.company_name.toLowerCase()}|${company.company_domain ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(company)
  }
  return merged
}
