'use client'

import { useState, useEffect } from 'react'

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
  const [form, setForm] = useState({ company_name: '', company_domain: '', notes: '' })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/watchlist')
      .then(r => r.json())
      .then(d => { setCompanies(d.companies ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function addCompany(e: React.FormEvent) {
    e.preventDefault()
    if (!form.company_name.trim()) return
    setAdding(true)
    setError(null)

    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Failed to add company')
      setAdding(false)
      return
    }

    setCompanies(prev => [data.company, ...prev])
    setForm({ company_name: '', company_domain: '', notes: '' })
    setAdding(false)
  }

  async function removeCompany(id: string) {
    const res = await fetch('/api/watchlist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      setCompanies(prev => prev.filter(c => c.id !== id))
    }
  }

  return (
    <div className="border border-gray-800 rounded-xl bg-gray-900/50">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
          <span className="text-sm font-medium text-gray-300">
            Watchlist
          </span>
          {!loading && (
            <span className="text-xs text-gray-500">
              {companies.length} {companies.length === 1 ? 'company' : 'companies'} — signals boosted
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-600 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-800 pt-3">
          {/* Add form */}
          <form onSubmit={addCompany} className="flex gap-2">
            <input
              type="text"
              placeholder="Company name"
              value={form.company_name}
              onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))}
              className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="text"
              placeholder="domain.com (optional)"
              value={form.company_domain}
              onChange={e => setForm(f => ({ ...f, company_domain: e.target.value }))}
              className="w-36 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={adding || !form.company_name.trim()}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {adding ? '…' : 'Watch'}
            </button>
          </form>

          {error && <p className="text-xs text-red-400">{error}</p>}

          {/* Company list */}
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map(i => (
                <div key={i} className="h-8 bg-gray-800 rounded animate-pulse" />
              ))}
            </div>
          ) : companies.length === 0 ? (
            <p className="text-xs text-gray-600 py-2">
              Add companies you care about — any signal from them bypasses the relevance filter.
            </p>
          ) : (
            <div className="space-y-1.5">
              {companies.map(c => (
                <div
                  key={c.id}
                  className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800/60 group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-white truncate">{c.company_name}</span>
                    {c.company_domain && (
                      <span className="text-xs text-gray-500 shrink-0">{c.company_domain}</span>
                    )}
                  </div>
                  <button
                    onClick={() => removeCompany(c.id)}
                    className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all p-1 shrink-0"
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
