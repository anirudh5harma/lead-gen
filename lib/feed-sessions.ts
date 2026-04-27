import type { LeadOrigin } from './lead-sources'

function formatSessionDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

export function buildFeedSessionLabel(params: {
  origin: LeadOrigin
  startedAt: string
  prompt?: string | null
  provider?: string | null
  recordCount?: number | null
}): string {
  const timestamp = formatSessionDate(params.startedAt)

  if (params.origin === 'explore') {
    if (params.prompt?.trim()) {
      return `Explore · ${compactText(params.prompt, 52)}`
    }
    return `Explore · ${timestamp}`
  }

  if (params.origin === 'crm_import') {
    const provider = (params.provider ?? 'CRM').replace(/[_-]+/g, ' ').trim()
    const providerLabel = provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'CRM'
    const countLabel = typeof params.recordCount === 'number' && params.recordCount > 0
      ? ` · ${params.recordCount} record${params.recordCount === 1 ? '' : 's'}`
      : ''
    return `${providerLabel} import${countLabel} · ${timestamp}`
  }

  return `Signal feed · ${timestamp}`
}
